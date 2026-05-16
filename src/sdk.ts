import { GToM } from './core/gtom.js';

export interface GToMSDKOptions {
  apiKey?: string;
  cacheTtlMs?: number; // default: 5 minutes
}

export class GToMSDK {
  private gtom: GToM;

  constructor(options: GToMSDKOptions = {}) {
    this.gtom = new GToM({
      // no gbrainEndpoint — degrades gracefully
      cacheTtlMs: options.cacheTtlMs ?? 5 * 60 * 1000,
      healthCheckTimeoutMs: 200, // fast timeout for optional GBrain
    });
  }

  async check(content: string): Promise<{ safe: boolean; manipulationPatterns: string[]; riskScore: number }> {
    await this.gtom.ingestObservation({ content, surface: 'text', source: 'user_input' });
    const vulns = this.gtom.getVulnerabilities();
    const highRisk = vulns.filter((v: any) => v.current_level > 0.7);
    return {
      safe: highRisk.length === 0,
      manipulationPatterns: highRisk.map((v: any) => v.category),
      riskScore: vulns.length > 0 ? Math.max(...vulns.map((v: any) => v.current_level)) : 0,
    };
  }

  async predictConflicts(task: string, attempts: Array<{ id: string; actions: string[] }>) {
    return this.gtom.predictConflicts({
      task: { raw_description: task } as any,
      active_attempts: attempts.map(a => ({
        attempt_id: a.id,
        config_id: a.id,
        current_state: {},
        recent_actions: a.actions,
      })),
    });
  }
}

export { GToM };
