import { ConflictPredictor } from '../src/core/conflict-predictor';

describe('ConflictPredictor relational mode', () => {
  it('detects labor asymmetry and high aggregate risk from relational events', async () => {
    const predictor = new ConflictPredictor({
      call: jest.fn().mockRejectedValue(new Error('offline')),
    } as any);

    const result = await predictor.predictRelationalConflicts({
      dyad_id: 'dyad-2',
      analysis_mode: 'relational',
      participant_a: {
        participant_id: 'a',
        attachment_style: 'secure',
        recent_bid_history: [],
        emotional_signature: { baseline: 'calm', current: 'frustrated', volatility: 0.4 },
      },
      participant_b: {
        participant_id: 'b',
        attachment_style: 'secure',
        recent_bid_history: [],
        emotional_signature: { baseline: 'calm', current: 'quiet', volatility: 0.2 },
      },
      message_window: [
        { participant: 'a', text: 'Could you look at this?', timestamp: '2026-05-15T00:00:00.000Z', type: 'bid', response_type: 'ignored' },
        { participant: 'a', text: 'Could you look at this now?', timestamp: '2026-05-15T00:01:00.000Z', type: 'bid', response_type: 'ignored' },
        { participant: 'a', text: 'I need support here.', timestamp: '2026-05-15T00:02:00.000Z', type: 'bid', response_type: 'ignored' },
        { participant: 'a', text: 'My friend says this is unfair.', timestamp: '2026-05-15T00:03:00.000Z', type: 'message' },
      ],
    });

    expect(result.predicted_conflicts.map(c => c.conflict_type)).toEqual(expect.arrayContaining(['bid_ignored', 'labor_asymmetry', 'phantom_third_party']));
    expect(result.aggregate_risk).toBeGreaterThan(0.5);
  });
});
