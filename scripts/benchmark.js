#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'benchmarks');
const latestPath = path.join(outDir, 'latest.json');
const baselinePath = path.join(outDir, 'gtom-baseline.json');

async function main() {
  const { GToM } = await import('../dist/GToM/src/core/gtom.js');
  const { captureMemoryProfile } = await import('../dist/GToM/src/core/performance.js');
  const iterations = Number(process.env.GTOM_BENCH_ITERATIONS ?? 20);
  const gtom = new GToM({
    gbrainClient: {
      getEndpoint: () => 'memory://benchmark',
      health: async () => ({ available: true, degraded: false, source: 'http', value: { healthy: true, endpoint: 'memory://benchmark', mode: 'http', circuit: 'closed' } }),
      queryCognitiveContext: async () => ({ available: true, degraded: false, source: 'http', value: { beliefs: [], desires: [], intentions: [], biases: [] } }),
      whoKnows: async () => ({ available: true, degraded: false, source: 'http', value: { user_id: 'bench', facts: [] } }),
      summarizeContext: () => [],
    },
    receiptRegistryOptions: {
      baseDir: path.join(os.tmpdir(), `gtom-bench-${Date.now()}`),
    },
  });

  const result = {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    iterations,
    node: process.version,
    benchmarks: {},
    memory: {
      before: captureMemoryProfile(),
      after: null,
    },
  };

  result.benchmarks.score_decision = await measure(iterations, () => gtom.scoreDecisionAuthenticity({
    context: 'The user has time to compare reversible implementation options.',
    action: 'Proceed with the scoped reversible implementation and record receipts.',
  }));
  result.benchmarks.predict_conflict = await measure(iterations, () => gtom.predictConflict({
    task: { raw_description: 'Update a TypeScript service and docs' },
    active_attempts: [],
  }));
  result.memory.after = captureMemoryProfile();

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(latestPath, `${JSON.stringify(result, null, 2)}\n`);
  const comparison = compareToBaseline(result);
  console.log(JSON.stringify({ latest: latestPath, comparison }, null, 2));
  if (comparison.regressed && process.env.BENCHMARK_ENFORCE === '1') {
    process.exit(1);
  }
}

async function measure(iterations, fn) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const sum = samples.reduce((total, sample) => total + sample, 0);
  return {
    min_ms: round(samples[0]),
    p50_ms: round(percentile(samples, 0.50)),
    p95_ms: round(percentile(samples, 0.95)),
    max_ms: round(samples[samples.length - 1]),
    avg_ms: round(sum / samples.length),
    ops_per_sec: round(1000 / (sum / samples.length)),
  };
}

function compareToBaseline(result) {
  if (!fs.existsSync(baselinePath)) {
    return { baseline: null, regressed: false, notes: ['No baseline found'] };
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const notes = [];
  let regressed = false;
  for (const [name, current] of Object.entries(result.benchmarks)) {
    const prior = baseline.benchmarks?.[name];
    if (!prior) continue;
    const allowed = prior.p95_ms * 1.25 + 5;
    if (current.p95_ms > allowed) {
      regressed = true;
      notes.push(`${name} p95 ${current.p95_ms}ms exceeds baseline budget ${round(allowed)}ms`);
    }
  }
  return { baseline: baselinePath, regressed, notes };
}

function percentile(samples, p) {
  const index = Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1);
  return samples[index];
}

function round(value) {
  return Number(value.toFixed(3));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
