#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const { GToM } = await import('../dist/GToM/src/core/gtom.js');
  const { captureMemoryProfile } = await import('../dist/GToM/src/core/performance.js');
  const samples = [];
  const gtom = new GToM({
    gbrainClient: {
      getEndpoint: () => 'memory://profile',
      health: async () => ({ available: true, degraded: false, source: 'http', value: { healthy: true, endpoint: 'memory://profile', mode: 'http', circuit: 'closed' } }),
      queryCognitiveContext: async () => ({ available: true, degraded: false, source: 'http', value: { beliefs: [], desires: [], intentions: [], biases: [] } }),
      summarizeContext: () => [],
    },
    receiptRegistryOptions: {
      baseDir: path.join(os.tmpdir(), `gtom-memory-${Date.now()}`),
    },
  });
  samples.push(captureMemoryProfile());
  for (let i = 0; i < Number(process.env.GTOM_MEMORY_PROFILE_ITERATIONS ?? 50); i++) {
    await gtom.predictConflict({ task: { raw_description: `profile-${i}` }, active_attempts: [] });
    if (i % 10 === 0) samples.push(captureMemoryProfile());
  }
  samples.push(captureMemoryProfile());
  const output = {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    samples,
    delta_heap_used_bytes: samples[samples.length - 1].heap_used_bytes - samples[0].heap_used_bytes,
  };
  const outPath = path.join('benchmarks', 'memory-latest.json');
  fs.mkdirSync('benchmarks', { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: outPath, delta_heap_used_bytes: output.delta_heap_used_bytes }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
