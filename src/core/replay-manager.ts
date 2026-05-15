import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ReplayResult {
  found: boolean;
  content?: string;
  metadata: {
    tool: string;
    timestamp: string;
    task?: string;
    hash?: string;
  };
}

export class ReplayManager {
  constructor(private readonly corpusPath: string) {}

  async retrieve(hash: string): Promise<ReplayResult> {
    const candidates = [
      path.join(this.corpusPath, `${hash}.json`),
      path.join(this.corpusPath, `${hash}.txt`),
      path.join(this.corpusPath, hash),
    ];
    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, 'utf8');
        if (candidate.endsWith('.json')) {
          const parsed = JSON.parse(content) as { content?: string; metadata?: Record<string, unknown>; task?: string };
          return {
            found: true,
            content: parsed.content ?? content,
            metadata: {
              tool: String(parsed.metadata?.tool ?? 'gtom'),
              timestamp: String(parsed.metadata?.timestamp ?? new Date(0).toISOString()),
              task: typeof parsed.task === 'string' ? parsed.task : undefined,
              hash,
            },
          };
        }
        return {
          found: true,
          content,
          metadata: {
            tool: 'gtom',
            timestamp: new Date(0).toISOString(),
            hash,
          },
        };
      } catch {
        // Try the next candidate path.
      }
    }
    return {
      found: false,
      metadata: {
        tool: 'gtom',
        timestamp: new Date(0).toISOString(),
        hash,
      },
    };
  }
}
