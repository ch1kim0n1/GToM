import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GToM } from '../core/gtom.js';
import { globalObservability } from '../core/observability.js';
import { createAuthMiddleware } from '../core/token-auth.js';
import { defaultSecretManager } from '../core/secret-manager.js';
import {
  AccessPrincipal,
  AccessScope,
  PermissionManager,
  constantTimeEquals,
  hashToken,
} from '../core/security.js';

type MCPScope = AccessScope;

interface MCPAccessContext {
  token: string;
  scopes: MCPScope[];
  userId: string;
  tokenHash?: string;
}

interface MCPRateWindow {
  minute_count: number;
  minute_start: number;
  hour_count: number;
  hour_start: number;
}

const TOOL_SCOPES: Record<string, MCPScope[]> = {
  gtom_ingest: ['write'],
  gtom_score: ['write'],
  gtom_audit: ['read'],
  gtom_vulnerabilities: ['read'],
  gtom_health: ['read'],
  gtom_get_receipts: ['read'],
  gtom_get_drift: ['read'],
  get_drift: ['read'],
  gtom_get_cost_stats: ['read'],
  gtom_authenticity_history: ['read'],
  gtom_get_authenticity_history: ['read'],
  get_authenticity_history: ['read'],
  gtom_get_indicators: ['read'],
  get_indicators: ['read'],
};

/**
 * MCP Server for GToM
 * 
 * Exposes GToM functionality as MCP tools for Claude Code and other agents
 */
class GToMMCPServer {
  private server: Server;
  private gtom: GToM;
  private authMiddleware: any;
  private rateUsage = new Map<string, MCPRateWindow>();
  private readonly authRequired: boolean;
  private readonly rateLimitRpm: number;
  private readonly rateLimitRph: number;
  private readonly permissions: PermissionManager;

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
    const authSecret = defaultSecretManager.getSecret('GTOM_AUTH_SECRET') || 'dev-secret-key';
    this.authMiddleware = createAuthMiddleware({
      secret: authSecret,
      tool: 'gtom',
      defaultRoles: ['read', 'write'],
    });

    this.authRequired = process.env.GTOM_MCP_AUTH_REQUIRED === 'true';
    this.rateLimitRpm = parseInt(process.env.GTOM_RATE_LIMIT_RPM || '60', 10);
    this.rateLimitRph = parseInt(process.env.GTOM_RATE_LIMIT_RPH || '1000', 10);
    this.permissions = new PermissionManager();

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
            name: 'get_drift',
            description: 'Alias for gtom_get_drift',
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
          {
            name: 'gtom_get_authenticity_history',
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
          {
            name: 'get_authenticity_history',
            description: 'Alias for gtom_get_authenticity_history',
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
          {
            name: 'gtom_get_indicators',
            description: 'Get current manipulation and vulnerability indicators',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of influence events to return',
                },
              },
            },
          },
          {
            name: 'get_indicators',
            description: 'Alias for gtom_get_indicators',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of influence events to return',
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

      const access = this.authorize(name, request.params._meta as Record<string, unknown> | undefined);
      if (!access.ok) {
        return this.errorResponse(access.error);
      }

      const rateLimit = this.checkRateLimit(access.context.token);
      if (!rateLimit.allowed) {
        globalObservability.audit.recordSecurityEvent({
          event_type: 'mcp_rate_limit_exceeded',
          actor: access.context.userId,
          resource: name,
          scopes: access.context.scopes,
          metadata: {
            token_hash: access.context.tokenHash,
            reset_at: rateLimit.reset_at,
          },
        });
        return this.errorResponse(`Rate limit exceeded. Reset at ${rateLimit.reset_at}`);
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
          case 'get_drift':
            return await this.handleGetDrift(args as any);
          case 'gtom_get_cost_stats':
            return await this.handleGetCostStats();
          case 'gtom_authenticity_history':
          case 'gtom_get_authenticity_history':
          case 'get_authenticity_history':
            return await this.handleAuthenticityHistory(args as any);
          case 'gtom_get_indicators':
          case 'get_indicators':
            return await this.handleGetIndicators(args as any);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return this.errorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private authorize(toolName: string, meta?: Record<string, unknown>): { ok: true; context: MCPAccessContext } | { ok: false; error: string } {
    const authHeader = this.getAuthHeader(meta);
    if (!authHeader && !this.authRequired) {
      return { ok: true, context: { token: 'anonymous-dev-stdio', scopes: ['read', 'write'], userId: 'anonymous-dev-stdio' } };
    }
    if (!authHeader) {
      this.recordSecurityEvent('mcp_auth_missing', toolName, 'anonymous');
      return { ok: false, error: 'Authentication failed: missing authorization token' };
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const tokenHash = hashToken(token);
    const configuredPrincipal = this.principalForConfiguredToken(token);
    let principal = configuredPrincipal;
    if (!principal) {
      const auth = this.authMiddleware.authenticate(authHeader);
      if (!auth.success) {
        this.recordSecurityEvent('mcp_auth_failed', toolName, 'unknown', { token_hash: tokenHash, error: auth.error });
        return { ok: false, error: `Authentication failed: ${auth.error}` };
      }
      const scopes = this.normalizeScopes(auth.token?.roles ?? []);
      principal = this.permissions.getPrincipal(String(auth.token?.userId ?? auth.token?.sub ?? `token-${tokenHash}`), scopes);
      principal.tokenHash = tokenHash;
    }

    const requiredScopes = TOOL_SCOPES[toolName] ?? ['read'];
    if (!this.permissions.authorize(principal, requiredScopes, toolName)) {
      return { ok: false, error: `Authorization failed: ${toolName} requires ${requiredScopes.join(', ')} scope` };
    }

    return { ok: true, context: { token, scopes: principal.scopes, userId: principal.userId, tokenHash } };
  }

  private getAuthHeader(meta?: Record<string, unknown>): string {
    const auth = meta?.authorization ?? meta?.gtom_authorization;
    if (typeof auth === 'string') return auth;
    const token = meta?.token ?? meta?.gtom_token;
    return typeof token === 'string' ? `Bearer ${token}` : '';
  }

  private principalForConfiguredToken(token: string): AccessPrincipal | null {
    const configured: Array<[string | undefined, MCPScope[], string]> = [
      [defaultSecretManager.getSecret('GTOM_MCP_ADMIN_TOKEN'), ['admin'], 'mcp-admin'],
      [defaultSecretManager.getSecret('GTOM_MCP_WRITE_TOKEN'), ['read', 'write'], 'mcp-writer'],
      [defaultSecretManager.getSecret('GTOM_MCP_READ_TOKEN'), ['read'], 'mcp-reader'],
    ];
    for (const [configuredToken, scopes, userId] of configured) {
      if (configuredToken && constantTimeEquals(token, configuredToken)) {
        const principal = this.permissions.getPrincipal(userId, scopes);
        principal.tokenHash = hashToken(token);
        return principal;
      }
    }
    return null;
  }

  private normalizeScopes(scopes: string[]): MCPScope[] {
    const result = scopes.filter((scope): scope is MCPScope => ['read', 'write', 'admin'].includes(scope));
    return result.length > 0 ? result : ['read'];
  }

  private recordSecurityEvent(
    eventType: string,
    resource: string,
    actor: string,
    metadata?: Record<string, unknown>,
  ): void {
    globalObservability.audit.recordSecurityEvent({
      event_type: eventType,
      actor,
      resource,
      metadata,
    });
  }

  private checkRateLimit(token: string): { allowed: boolean; remaining: number; reset_at: string } {
    const now = Date.now();
    const minuteWindow = 60 * 1000;
    const hourWindow = 60 * 60 * 1000;
    const current = this.rateUsage.get(token) ?? {
      minute_count: 0,
      minute_start: now,
      hour_count: 0,
      hour_start: now,
    };

    if (now - current.minute_start >= minuteWindow) {
      current.minute_count = 0;
      current.minute_start = now;
    }
    if (now - current.hour_start >= hourWindow) {
      current.hour_count = 0;
      current.hour_start = now;
    }

    const minuteExceeded = current.minute_count >= this.rateLimitRpm;
    const hourExceeded = current.hour_count >= this.rateLimitRph;
    if (minuteExceeded || hourExceeded) {
      const resetAt = hourExceeded
        ? current.hour_start + hourWindow
        : current.minute_start + minuteWindow;
      return {
        allowed: false,
        remaining: 0,
        reset_at: new Date(resetAt).toISOString(),
      };
    }

    current.minute_count++;
    current.hour_count++;
    this.rateUsage.set(token, current);
    return {
      allowed: true,
      remaining: Math.min(this.rateLimitRpm - current.minute_count, this.rateLimitRph - current.hour_count),
      reset_at: new Date(current.minute_start + minuteWindow).toISOString(),
    };
  }

  private errorResponse(message: string) {
    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
    };
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

  private async handleGetIndicators(args: {
    limit?: number;
  }) {
    const limit = args.limit || 25;
    const vulnerabilities = this.gtom.getVulnerabilities();
    const influenceLedger = this.gtom.getInfluenceLedger(limit);
    const indicators = vulnerabilities
      .filter((vulnerability) => vulnerability.current_level > vulnerability.baseline_level)
      .map((vulnerability) => ({
        category: vulnerability.category,
        current_level: vulnerability.current_level,
        baseline_level: vulnerability.baseline_level,
        delta: vulnerability.current_level - vulnerability.baseline_level,
        evidence_count: vulnerability.evidence_count,
        recent_exposures: vulnerability.recent_exposures,
      }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            aggregate: this.gtom.getAggregateVulnerability(),
            indicators,
            influence_ledger: influenceLedger,
          }, null, 2),
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
    globalObservability.logger.info('GToM MCP Server started');
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new GToMMCPServer();
  server.start().catch((error) => globalObservability.logger.error('GToM MCP Server failed to start', error));
}

export { GToMMCPServer };
