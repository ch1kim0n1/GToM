import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GToM } from '../core/gtom.js';

/**
 * MCP Server for GToM
 * 
 * Exposes GToM functionality as MCP tools for Claude Code and other agents
 */
class GToMMCPServer {
  private server: Server;
  private gtom: GToM;

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
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

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
    const score = this.gtom.scoreDecisionAuthenticity({
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
