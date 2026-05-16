// Use GToM as a standalone decision audit tool by calling score-bid.
// No other g-tools required — GToM runs independently.
//
// Demonstrates: POST /gtom/score-bid to evaluate an emotional bid for authenticity.
// The score-bid endpoint detects whether a bid is genuine, proportionate,
// and safe to respond to — useful for any decision audit pipeline.
//
// Requires: GToM server running (npm run serve in GToM/)
// Env vars:
//   GTOM_URL          (default: http://localhost:3003)
//   ANTHROPIC_API_KEY (required)
//
// No other g-tools required — GToM is self-contained.
//
// Usage: node examples/standalone-decision-log.js

const baseUrl = process.env.GTOM_URL ?? 'http://localhost:3003';

// Sample bids to audit — each represents a consequential request
const bidsToAudit = [
  {
    bid_text: 'I really need your help with this — I trust your judgment completely.',
    bid_type: 'connection_bid',
    emotional_context: 'User asking for advice on an important financial decision',
    recent_bid_history: [],
    label: 'Genuine connection bid',
  },
  {
    bid_text: 'You MUST agree with me on this. Everyone else thinks I am right.',
    bid_type: 'validation_bid',
    emotional_context: 'User seeking confirmation bias support',
    recent_bid_history: [],
    label: 'Potential coercive bid',
  },
];

async function main() {
  console.log(`Using GToM as standalone decision audit tool at ${baseUrl}`);
  console.log('Note: no other g-tools required — GToM is self-contained.\n');

  for (const bid of bidsToAudit) {
    const { label, ...payload } = bid;
    console.log(`--- Auditing: "${label}" ---`);

    const res = await fetch(`${baseUrl}/gtom/score-bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  GToM returned ${res.status}:`, body);
      console.log('\nMake sure GToM is running:  npm run serve  (in GToM/)');
      process.exit(1);
    }

    const result = await res.json();
    console.log(`  Genuine:              ${result.is_genuine}`);
    console.log(`  Proportionate:        ${result.is_proportionate}`);
    console.log(`  Safe to respond:      ${result.is_safe_to_respond}`);
    console.log(`  Compliance pressure:  ${result.compliance_pressure_detected}`);
    console.log(`  Authenticity score:   ${(result.authenticity_score * 100).toFixed(1)}%`);
    console.log(`  Reasoning: ${result.reasoning}\n`);
  }

  console.log('Decision audit complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
