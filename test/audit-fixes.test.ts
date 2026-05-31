// Regression tests for audit issues #40-#54.
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHmac } from 'node:crypto';
import { createAuthMiddleware } from '../src/core/token-auth';
import { FixedWindowRateLimiter, hashToken } from '../src/core/security';
import { FileSecretManager } from '../src/core/secret-manager';
import { sanitizeUrl, isBlockedHost } from '../src/core/input-sanitizer';
import { ConflictPredictor } from '../src/core/conflict-predictor';
import { GToMServer } from '../src/server';
import {
  ConflictPredictionResponseSchema,
  RelationalConflictResponseSchema,
} from '../src/types/index';

function signedToken(secret: string, payload: Record<string, unknown>): string {
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadPart).digest('hex');
  return `${payloadPart}.${signature}`;
}

describe('#41 token auth', () => {
  const secret = 'unit-secret';
  const mw = createAuthMiddleware({ secret, tool: 'gtom', defaultRoles: ['read', 'write'] });

  it('rejects an opaque/unsigned bearer token', () => {
    expect(mw.authenticate('Bearer anything').success).toBe(false);
    expect(mw.authenticate('Bearer x').success).toBe(false);
  });

  it('rejects a token with an invalid signature', () => {
    const payloadPart = Buffer.from(JSON.stringify({ sub: 'u', exp: Date.now() / 1000 + 60 })).toString('base64url');
    expect(mw.authenticate(`Bearer ${payloadPart}.deadbeef`).success).toBe(false);
  });

  it('rejects an expired token', () => {
    const token = signedToken(secret, { sub: 'u', exp: Math.floor(Date.now() / 1000) - 10 });
    const result = mw.authenticate(`Bearer ${token}`);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expired/);
  });

  it('rejects a token with no exp claim', () => {
    const token = signedToken(secret, { sub: 'u' });
    expect(mw.authenticate(`Bearer ${token}`).success).toBe(false);
  });

  it('accepts a valid signed, unexpired token', () => {
    const token = signedToken(secret, { sub: 'u', roles: ['read'], exp: Math.floor(Date.now() / 1000) + 60 });
    const result = mw.authenticate(`Bearer ${token}`);
    expect(result.success).toBe(true);
    expect(result.token?.sub).toBe('u');
  });
});

describe('#45 rate limiter bounding', () => {
  it('evicts stale windows and stays bounded under distinct identities', () => {
    const limiter = new FixedWindowRateLimiter(5, 100, 10);
    // Insert more than the cap of distinct identities within the same window.
    for (let i = 0; i < 50; i++) {
      limiter.check(`id-${i}`, 1000);
    }
    expect(limiter.size()).toBeLessThanOrEqual(10);
  });

  it('drops windows older than the hour window', () => {
    const limiter = new FixedWindowRateLimiter(5, 100, 10000);
    limiter.check('old', 0);
    // A new identity far in the future triggers a sweep of the stale 'old' entry.
    limiter.check('new', 2 * 60 * 60 * 1000);
    expect(limiter.size()).toBe(1);
  });
});

describe('#53 hashToken length', () => {
  it('produces a 128-bit (32 hex char) identifier', () => {
    expect(hashToken('abc')).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('#44 secret store', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-audit-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.GTOM_ALLOW_PLAINTEXT_SECRETS;
  });

  it('refuses to store a sensitive secret without a master key', () => {
    const mgr = new FileSecretManager({ filePath: path.join(tmp, 's.json'), envFallback: false });
    expect(() => mgr.setSecret('ANTHROPIC_API_KEY', 'sk-xxx')).toThrow(/GTOM_SECRETS_MASTER_KEY/);
  });

  it('stores a non-sensitive secret as base64 with a warning (no master key)', () => {
    const mgr = new FileSecretManager({ filePath: path.join(tmp, 's.json'), envFallback: false });
    const meta = mgr.setSecret('FEATURE_FLAG', 'on');
    expect(meta.encrypted).toBe(false);
    expect(mgr.getSecret('FEATURE_FLAG')).toBe('on');
  });

  it('encrypts with a master key (AES-256-GCM, not base64)', () => {
    const mgr = new FileSecretManager({ filePath: path.join(tmp, 's.json'), masterKey: 'k', envFallback: false });
    const meta = mgr.setSecret('ANTHROPIC_API_KEY', 'sk-secret-value');
    expect(meta.encrypted).toBe(true);
    const raw = fs.readFileSync(path.join(tmp, 's.json'), 'utf8');
    expect(raw).not.toContain('sk-secret-value');
    expect(mgr.getSecret('ANTHROPIC_API_KEY')).toBe('sk-secret-value');
  });
});

describe('#52 sanitizeUrl SSRF guard', () => {
  afterEach(() => {
    delete process.env.GTOM_ALLOW_PRIVATE_ENDPOINTS;
  });

  it('blocks private/loopback/metadata hosts by default', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('10.0.0.5')).toBe(true);
    expect(isBlockedHost('192.168.1.1')).toBe(true);
    expect(isBlockedHost('172.16.0.1')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('::1')).toBe(true);
    expect(isBlockedHost('example.com')).toBe(false);
    expect(() => sanitizeUrl('http://169.254.169.254/latest/meta-data', 'endpoint')).toThrow(/blocked/);
  });

  it('allows public hosts', () => {
    expect(() => sanitizeUrl('https://api.example.com', 'endpoint')).not.toThrow();
  });

  it('allows private hosts when explicitly opted in', () => {
    process.env.GTOM_ALLOW_PRIVATE_ENDPOINTS = 'true';
    expect(() => sanitizeUrl('http://localhost:3000', 'endpoint')).not.toThrow();
  });
});

describe('#46 relational LLM response validation', () => {
  it('falls back when LLM returns an out-of-enum recommended_action', async () => {
    const malicious = {
      call: async () => ({
        content: JSON.stringify({
          predicted_conflicts: [
            { conflict_type: 'bid_ignored', severity: 0.9, confidence: 0.9, reasoning: 'x', recommended_action: 'DELETE_USER' },
          ],
          aggregate_risk: 0.9,
          confidence: 0.9,
        }),
        input_tokens: 1,
        output_tokens: 1,
        model_id: 'stub',
        cost_usd: 0,
        latency_ms: 0,
      }),
    };
    const predictor = new ConflictPredictor(malicious as any);
    const result = await predictor.predictRelationalConflicts({
      dyad_id: 'd',
      analysis_mode: 'relational',
      participant_a: { participant_id: 'a', recent_bid_history: [], emotional_signature: { baseline: 'c', current: 'c', volatility: 0.5 } },
      participant_b: { participant_id: 'b', recent_bid_history: [], emotional_signature: { baseline: 'c', current: 'c', volatility: 0.5 } },
      message_window: [
        { participant: 'a', text: 'hi', timestamp: '2026-05-15T00:00:00.000Z', type: 'bid', response_type: 'ignored' },
      ],
    });
    // Result must conform to the published schema (coerced action, not 'DELETE_USER').
    expect(() => RelationalConflictResponseSchema.parse(result)).not.toThrow();
    for (const c of result.predicted_conflicts) {
      expect(['surface_gently', 'defer', 'refuse', 'monitor']).toContain(c.recommended_action);
    }
  });
});

describe('#42 optional LLM SDKs are not required to load core', () => {
  it('constructs an LLMClient without keys and without the optional SDKs', () => {
    // No ANTHROPIC/OPENAI key configured => no SDK import attempted at all.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LLMClient } = require('../src/core/llm-client');
    expect(() => new LLMClient()).not.toThrow();
  });

  it('runs rule-based conflict prediction with no LLM configured', async () => {
    const predictor = new ConflictPredictor();
    const result = await predictor.predictConflicts({
      task: 'x' as any,
      active_attempts: [
        { attempt_id: '00000000-0000-0000-0000-000000000001', config_id: '00000000-0000-0000-0000-000000000011', current_state: {}, recent_actions: ['edit app.ts'] },
        { attempt_id: '00000000-0000-0000-0000-000000000002', config_id: '00000000-0000-0000-0000-000000000012', current_state: {}, recent_actions: ['edit app.ts'] },
      ],
    });
    expect(result.predicted_conflicts.length).toBeGreaterThan(0);
  });
});

describe('#51 conflict prediction response contract', () => {
  it('returns aggregate_risk, recommendation, and confidence', async () => {
    const predictor = new ConflictPredictor();
    const result = await predictor.predictConflicts({
      task: 'x' as any,
      active_attempts: [],
    });
    expect(() => ConflictPredictionResponseSchema.parse(result)).not.toThrow();
    expect(typeof result.recommendation).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(typeof result.aggregate_risk).toBe('number');
  });
});

describe('#54 goal conflict detector', () => {
  it('detects incompatible performance vs security goals', async () => {
    const predictor = new ConflictPredictor();
    const result = await predictor.predictConflicts({
      task: 'x' as any,
      active_attempts: [
        { attempt_id: '00000000-0000-0000-0000-000000000001', config_id: '00000000-0000-0000-0000-000000000011', current_state: {}, recent_actions: ['optimize'] },
        { attempt_id: '00000000-0000-0000-0000-000000000002', config_id: '00000000-0000-0000-0000-000000000012', current_state: {}, recent_actions: ['security'] },
      ],
    });
    expect(result.predicted_conflicts.some(c => c.conflict_type === 'goal')).toBe(true);
  });
});

describe('#49 idempotent shutdown / no leaked signal handlers', () => {
  beforeEach(() => {
    process.env.GTOM_HTTP_AUTH_REQUIRED = 'false';
    process.env.GTOM_RECEIPT_SECRET = process.env.GTOM_RECEIPT_SECRET ?? 'unit-receipt-secret';
    process.env.GTOM_MCP_SECRET = process.env.GTOM_MCP_SECRET ?? 'unit-mcp-secret';
  });

  function makeServer(): GToMServer {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GToM } = require('../src/core/gtom');
    return new GToMServer(new GToM({ healthCheckTimeoutMs: 50 }), 0);
  }

  it('does not leak SIGTERM/SIGINT listeners across start/stop cycles', async () => {
    const before = process.listenerCount('SIGTERM');
    for (let i = 0; i < 5; i++) {
      const server = makeServer();
      await server.start();
      server.stop();
    }
    expect(process.listenerCount('SIGTERM')).toBeLessThanOrEqual(before + 1);
  });

  it('shutdown() is idempotent', async () => {
    const server = makeServer();
    await server.start();
    await server.shutdown();
    await expect(server.shutdown()).resolves.toBeUndefined();
  });
});
