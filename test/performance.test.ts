import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BackpressureController,
  CancellationToken,
  LRUCache,
  MODEL_RESOLUTION_CHAIN_8,
  resolveModelFromChain,
} from '../src/core/performance';
import { GToM } from '../src/core/gtom';

describe('performance controls', () => {
  it('provides an eight-tier model resolution chain', () => {
    expect(MODEL_RESOLUTION_CHAIN_8).toHaveLength(8);
    expect(resolveModelFromChain({
      estimatedInputTokens: 500,
      availableProviders: ['openai'],
    }).model_id).toBe('gpt-4o-mini');
  });

  it('evicts LRU cache entries and honors ttl', () => {
    const cache = new LRUCache<string, string>(2, 100);
    cache.set('a', '1', 0);
    cache.set('b', '2', 0);
    expect(cache.get('a', 50)).toBe('1');
    cache.set('c', '3', 60);
    expect(cache.get('b', 60)).toBeUndefined();
    expect(cache.get('a', 101)).toBeUndefined();
  });

  it('applies backpressure and cancellation for queued work', async () => {
    const controller = new BackpressureController(1, 1);
    const release = await controller.acquire();
    const token = new CancellationToken();
    const queued = controller.acquire({ cancellationToken: token });
    token.cancel('unit cancelled');
    await expect(queued).rejects.toThrow('unit cancelled');
    release();
  });

  it('reports progress and caches GBrain context in GToM operations', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-performance-'));
    let queryCalls = 0;
    const gtom = new GToM({
      cacheTtlMs: 60_000,
      gbrainClient: {
        getEndpoint: () => 'memory://test',
        health: async () => ({ available: true, degraded: false, source: 'http', value: { healthy: true, endpoint: 'memory://test', mode: 'http', circuit: 'closed' } }),
        queryCognitiveContext: async () => {
          queryCalls++;
          return { available: true, degraded: false, source: 'http', value: { beliefs: [], desires: [], intentions: [], biases: [] } };
        },
        whoKnows: async () => ({ available: true, degraded: false, source: 'http', value: { user_id: 'user-1', facts: [] } }),
        summarizeContext: () => ['cached-context'],
      } as any,
      receiptRegistryOptions: { baseDir: tmpDir },
    });
    const events: string[] = [];

    await gtom.scoreDecisionAuthenticity({
      context: 'The user has time to review options.',
      action: 'Proceed with the reversible choice.',
      userId: 'user-1',
    }, { onProgress: (event) => events.push(event.stage) });
    await gtom.scoreDecisionAuthenticity({
      context: 'The user has time to review options.',
      action: 'Proceed with the reversible choice.',
      userId: 'user-1',
    });

    expect(events).toContain('started');
    expect(events).toContain('completed');
    expect(queryCalls).toBe(1);
    expect((gtom.getPerformanceStats().cache as any).size).toBeGreaterThanOrEqual(1);
  });
});
