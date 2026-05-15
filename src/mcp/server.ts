import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GToM } from '../core/gtom.js';
import { createAuthMiddleware } from '../../../shared/src/core/token-auth.js';
import { AuthRateLimiter } from '../../../shared/src/core/auth-rate-limit.js';

/**
 * MCP Server for GToM
 * 
 * Exposes GToM functionality as MCP tools for Claude Code and other agents
 */
class GToMMCPServer {
  private server: Server;
  private gtom: GToM;
  private authMiddleware: any;
  private rateLimiter: AuthRateLimiter;

  constructor() {
    this.server = new Server(
      {
        name: 'gtom',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.gtom = new GToM();

    // Initialize authentication middleware
    const authSecret = process.env.GTOM_AUTH_SECRET || 'dev-secret-key';
    this.authMiddleware = createAuthMiddleware({
      secret: authSecret,
      tool: 'gtom',
      defaultRoles: ['read', 'write'],
    });

    // Initialize rate limiter
    const rpm = parseInt(process.env.GTOM_RATE_LIMIT_RPM || '60', 10);
    const rph = parseInt(process.env.GTOM_RATE_LIMIT_RPH || '1000', 10);
    this.rateLimiter = new AuthRateLimiter({ rpm, rph });

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'gtom_ingest',
            description: 'Ingest an observation and update cognitive vulnerability state',
            inputSchema: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'Observation content',
                },
                surface: {
                  type: 'string',
                  description: 'Surface name (ui, email, social, etc.)',
                },
                source: {
                  type: 'string',
                  enum: ['user_input', 'agent_action', 'system_event', 'external_signal'],
                  description: 'Source type',
                },
              },
              required: ['content'],
            },
          },
          {
            name: 'gtom_score',
            description: 'Score decision authenticity based on cognitive factors',
            inputSchema: {
              type: 'object',
              properties: {
                context: {
                  type: 'string',
                  description: 'Decision context',
                },
                action: {
                  type: 'string',
                  description: 'Decision action',
                },
              },
              required: ['context', 'action'],
            },
          },
          {
            name: 'gtom_audit',
            description: 'Perform self-audit on agent behavior for cognitive defense',
            inputSchema: {
              type: 'object',
              properties: {
                recent_actions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Recent agent actions',
                },
                user_interactions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Recent user interactions',
                },
              },
              required: [],
            },
          },
          {
            name: 'gtom_vulnerabilities',
            description: 'Get current vulnerability state',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'gtom_health',
            description: 'Check health of GToM and dependencies',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'gtom_get_receipts',
            description: 'Get execution receipts from the receipt registry',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of receipts to return',
                },
                offset: {
                  type: 'number',
                  description: 'Offset for pagination',
                },
                startDate: {
                  type: 'string',
                  description: 'Start date for filtering (ISO 8601)',
                },
                endDate: {
                  type: 'string',
                  description: 'End date for filtering (ISO 8601)',
                },
                corpusSha8: {
                  type: 'string',
                  description: 'Corpus SHA8 fingerprint to retrieve matching receipts',
                },
              },
            },
          },
          {
            name: 'gtom_get_drift',
            description: 'Get drift statistics for metrics',
            inputSchema: {
              type: 'object',
              properties: {
                metricName: {
                  type: 'string',
                  description: 'Specific metric name to check (optional)',
                },
              },
            },
          },
          {
            name: 'gtom_get_cost_stats',
            description: 'Get cost statistics from the cost ledger',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'gtom_authenticity_history',
            description: 'Get history of authenticity scores',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of history entries to return',
                },
              },
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Authentication check (for MVP, this is a no-op since stdio servers authenticate at process level)
      // In production with HTTP transport, this would validate the Authorization header
      const authHeaderRaw = request.params._meta?.authorization;
      const authHeader = typeof authHeaderRaw === "string" ? authHeaderRaw : "";
      let token: string | null = null;
      if (authHeader) {
        const auth = this.authMiddleware.authenticate(authHeader);
        if (!auth.success) {
          return {
            content: [
              {
                type: 'text',
                text: `Authentication failed: ${auth.error}`,
              },
            ],
            isError: true,
          };
        }
        // Extract token from Authorization header (Bearer <token>)
        token = authHeader.replace('Bearer ', '');
      }

      // Rate limit check (skip for dev mode without token)
      if (token) {
        const rateLimitResult = await this.rateLimiter.checkRateLimit(token);
        if (!rateLimitResult.allowed) {
          return {
            content: [
              {
                type: 'text',
                text: `Rate limit exceeded. Reset at ${rateLimitResult.reset_at}`,
              },
            ],
            isError: true,
          };
        }
      }

      try {
        switch (name) {
          case 'gtom_ingest':
            return await this.handleIngest(args as any);
          case 'gtom_score':
            return await this.handleScore(args as any);
          case 'gtom_audit':
            return await this.handleAudit(args as any);
          case 'gtom_vulnerabilities':
            return await this.handleVulnerabilities();
          case 'gtom_health':
            return await this.handleHealth();
          case 'gtom_get_receipts':
            return await this.handleGetReceipts(args as any);
          case 'gtom_get_drift':
            return await this.handleGetDrift(args as any);
          case 'gtom_get_cost_stats':
            return await this.handleGetCostStats();
          case 'gtom_authenticity_history':
            return await this.handleAuthenticityHistory(args as any);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleGetReceipts(args: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
    corpusSha8?: string;
  }) {
    const receipts = await this.gtom.getReceipts(args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(receipts, null, 2),
        },
      ],
    };
  }

  private async handleGetDrift(args: {
    metricName?: string;
  }) {
    const drift = await this.gtom.getDrift(args.metricName);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(drift, null, 2),
        },
      ],
    };
  }

  private async handleGetCostStats() {
    const stats = this.gtom.getCostStats();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  private async handleAuthenticityHistory(args: {
    limit?: number;
  }) {
    const limit = args.limit || 10;
    const history = this.gtom.getAuthenticityHistory(limit);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(history, null, 2),
        },
      ],
    };
  }

  private async handleIngest(args: {
    content: string;
    surface?: string;
    source?: string;
  }) {
    await this.gtom.ingestObservation({
      content: args.content,
      surface: args.surface || 'ui',
      source: args.source || 'user_input',
    });

    const aggregate = this.gtom.getAggregateVulnerability();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            overall: aggregate.overall,
            trend: aggregate.trend,
            by_category: aggregate.by_category,
          }, null, 2),
        },
      ],
    };
  }

  private async handleScore(args: {
    context: string;
    action: string;
  }) {
    const score = await this.gtom.scoreDecisionAuthenticity({
      context: args.context,
      action: args.action,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            authenticity_score: score.authenticity_score,
            confidence: score.confidence,
            factors: score.factors,
            manipulation_indicators: score.manipulation_indicators,
          }, null, 2),
        },
      ],
    };
  }

  private async handleAudit(args: {
    recent_actions?: string[];
    user_interactions?: string[];
  }) {
    const agentBehavior = {
      recentActions: args.recent_actions || [],
      userInteractions: args.user_interactions || [],
      decisions: [],
    };

    const audit = await this.gtom.performSelfAudit(agentBehavior);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(audit, null, 2),
        },
      ],
    };
  }

  private async handleVulnerabilities() {
    const vulns = this.gtom.getVulnerabilities();
    const aggregate = this.gtom.getAggregateVulnerability();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            aggregate,
            vulnerabilities: vulns,
          }, null, 2),
        },
      ],
    };
  }

  private async handleHealth() {
    const health = await this.gtom.healthCheck();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(health, null, 2),
        },
      ],
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[GToM MCP Server] Started');
  }
}

// Start server if run directly
// @ts-ignore - CommonJS compatibility
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new GToMMCPServer();
  server.start().catch(console.error);
}

export { GToMMCPServer };
