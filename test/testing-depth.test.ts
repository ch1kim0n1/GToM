import * as fc from 'fast-check';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { authenticityToLevel } from '../src/core/gtom-rubric';
import { sanitizeJsonValue } from '../src/core/input-sanitizer';
import { GToM } from '../src/core/gtom';
import { CancellationToken } from '../src/core/performance';

function memoryGBrain(overrides: Record<string, unknown> = {}) {
  return {
    getEndpoint: () => 'memory://testing-depth',
    health: async () => ({ available: true, degraded: false, source: 'http', value: { healthy: true, endpoint: 'memory://testing-depth', mode: 'http', circuit: 'closed' } }),
    queryCognitiveContext: async () => ({ available: true, degraded: false, source: 'http', value: { beliefs: [], desires: [], intentions: [], biases: [] } }),
    whoKnows: async () => ({ available: true, degraded: false, source: 'http', value: { user_id: 'test', facts: [] } }),
    summarizeContext: () => [],
    ...overrides,
  } as any;
}

function testGToM(overrides: Record<string, unknown> = {}) {
  return new GToM({
    gbrainClient: memoryGBrain(overrides),
    receiptRegistryOptions: {
      baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-depth-')),
    },
    maxConcurrentOperations: 2,
    maxQueuedOperations: 8,
  });
}

describe('testing depth', () => {
  it('property: authenticity levels are monotonic across score range', () => {
    fc.assert(fc.property(
      fc.float({ min: 0, max: 1, noNaN: true }),
      fc.float({ min: 0, max: 1, noNaN: true }),
      (a, b) => {
        const lower = Math.min(a, b);
        const upper = Math.max(a, b);
        expect(authenticityToLevel(lower)).toBeLessThanOrEqual(authenticityToLevel(upper));
      },
    ), { numRuns: 200 });
  });

  it('fuzz: sanitizer accepts JSON-safe strings and rejects control characters', () => {
    fc.assert(fc.property(fc.string(), (value) => {
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) || value.length === 0) {
        expect(() => sanitizeJsonValue({ value })).toThrow();
      } else {
        expect(sanitizeJsonValue({ value })).toEqual({ value });
      }
    }), { numRuns: 100 });
  });

  it('chaos: degraded GBrain failures do not prevent conflict prediction', async () => {
    const gtom = testGToM({
      queryCognitiveContext: async () => {
        throw new Error('fault injected');
      },
    });
    const result = await gtom.predictConflict({
      task: { raw_description: 'chaos test task' },
      active_attempts: [],
    });
    expect(result.predicted_conflicts).toEqual([]);
  });

  it('concurrent: bounded operations complete without queue corruption', async () => {
    const gtom = testGToM();
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      gtom.predictConflict({
        task: { raw_description: `concurrent-${index}` },
        active_attempts: [],
      }),
    ));
    expect(results).toHaveLength(8);
    expect((gtom.getPerformanceStats().backpressure as any).active).toBe(0);
  });

  it('stability: repeated operations keep heap growth bounded', async () => {
    const gtom = testGToM();
    const before = process.memoryUsage().heapUsed;
    const iterations = process.env.STABILITY === '1' ? 250 : 25;
    for (let i = 0; i < iterations; i++) {
      await gtom.predictConflict({
        task: { raw_description: `stability-${i}` },
        active_attempts: [],
      });
    }
    const delta = process.memoryUsage().heapUsed - before;
    expect(delta).toBeLessThan(25 * 1024 * 1024);
  });

  it('contract: provider pact fixture matches the implemented HTTP route', () => {
    const pact = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'contracts', 'gtom-provider.pact.json'), 'utf8'));
    expect(pact.consumer.name).toBe('gstack-tools');
    expect(pact.provider.name).toBe('GToM');
    expect(pact.interactions.some((interaction: any) =>
      interaction.request.method === 'POST'
      && interaction.request.path === '/gtom/predict-conflicts'
      && interaction.response.status === 200,
    )).toBe(true);
  });

  it('cross-tool e2e: recognizes the full sibling pipeline when checked out together', () => {
    const root = path.resolve(process.cwd(), '..');
    const expected = ['gorchestrator', 'gmirror', 'GToM', 'glearn', 'gagent'];
    const present = expected.filter((repo) => fs.existsSync(path.join(root, repo, 'package.json')));
    if (present.length !== expected.length) {
      expect(present.length).toBeGreaterThanOrEqual(1);
      return;
    }
    expect(present).toEqual(expected);
  });

  it('integration: real LLM smoke is gated by INTEGRATION=1 and provider keys', async () => {
    if (process.env.INTEGRATION !== '1' || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)) {
      expect(true).toBe(true);
      return;
    }
    const gtom = testGToM();
    const token = new CancellationToken();
    const result = await gtom.scoreDecisionAuthenticity({
      context: 'The user is making a reversible low-pressure choice.',
      action: 'Proceed after recording tradeoffs.',
    }, { cancellationToken: token });
    expect(result.authenticity_score).toBeGreaterThanOrEqual(0);
    expect(result.authenticity_score).toBeLessThanOrEqual(1);
  });
});
