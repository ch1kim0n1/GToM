// POST two competing task attempts to /gtom/predict-conflicts and print the conflict list.
// Demonstrates GToM's conflict prediction for parallel agent orchestration.
//
// Requires: GToM server running (npm run serve in GToM/)
// Env vars:
//   GTOM_URL          (default: http://localhost:3003)
//   ANTHROPIC_API_KEY (required by GToM for LLM-based analysis)
//
// Usage: node examples/detect-conflicts.js

const baseUrl = process.env.GTOM_URL ?? 'http://localhost:3003';

const attemptA = {
  attempt_id: '11111111-1111-1111-1111-111111111111',
  config_id:  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  current_state: {
    files_touched: ['src/db/migrations.ts', 'src/db/schema.ts'],
    task: 'Add users table migration',
  },
  recent_actions: [
    'read src/db/schema.ts',
    'write src/db/migrations/0001_add_users.ts',
    'write src/db/schema.ts',
  ],
};

const attemptB = {
  attempt_id: '22222222-2222-2222-2222-222222222222',
  config_id:  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  current_state: {
    files_touched: ['src/db/schema.ts', 'src/db/seed.ts'],
    task: 'Add roles column to existing schema',
  },
  recent_actions: [
    'read src/db/schema.ts',
    'write src/db/schema.ts',
    'write src/db/seed.ts',
  ],
};

async function main() {
  console.log(`Querying GToM at ${baseUrl} for conflict prediction\n`);

  const res = await fetch(`${baseUrl}/gtom/predict-conflicts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: 'Migrate database schema',
      active_attempts: [attemptA, attemptB],
      context: 'Parallel agents modifying the database schema simultaneously',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`GToM returned ${res.status}:`, body);
    console.log('\nMake sure GToM is running:  npm run serve  (in GToM/)');
    process.exit(1);
  }

  const result = await res.json();
  console.log('Conflict prediction result:');
  console.log(JSON.stringify(result, null, 2));

  const conflicts = result.predicted_conflicts ?? result.conflicts ?? [];
  console.log(`\nDetected ${conflicts.length} conflict(s).`);
  if (conflicts.length > 0) {
    conflicts.forEach((c, i) => {
      console.log(`  [${i + 1}] type=${c.conflict_type ?? c.type}, severity=${c.severity}, action=${c.recommended_action ?? 'n/a'}`);
    });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
