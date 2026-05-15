import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSecretManager } from '../src/core/secret-manager';
import { sanitizeIdentifier, sanitizeJsonValue, sanitizeUrl, sanitizeUserString } from '../src/core/input-sanitizer';
import { FixedWindowRateLimiter, PermissionManager, hashToken } from '../src/core/security';
import { LocalAuditLogger } from '../src/core/observability';

describe('security controls', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-security-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores, lists, and rotates secrets without exposing values in metadata', () => {
    const manager = new FileSecretManager({
      filePath: path.join(tmpDir, 'secrets.json'),
      masterKey: 'unit-master-key',
      envFallback: false,
    });

    const first = manager.setSecret('OPENAI_API_KEY', 'unit-openai-value-1', { scope: 'llm', owner: 'ci' });
    const second = manager.rotateSecret('OPENAI_API_KEY', 'unit-openai-value-2', { scope: 'llm', owner: 'ci' });
    const listed = manager.listSecrets();
    const rawStore = fs.readFileSync(manager.getFilePath(), 'utf8');

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(manager.getSecret('OPENAI_API_KEY')).toBe('unit-openai-value-2');
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('unit-openai-value');
    expect(rawStore).not.toContain('unit-openai-value');
  });

  it('enforces permissions and hashes tokens for audit-safe identifiers', () => {
    const manager = new PermissionManager([
      { userId: 'viewer-1', roles: ['viewer'], scopes: ['read'] },
      { userId: 'operator-1', roles: ['operator'], scopes: ['read', 'write'] },
    ]);

    expect(manager.authorize(manager.getPrincipal('viewer-1'), ['read'], 'gtom_health')).toBe(true);
    expect(manager.authorize(manager.getPrincipal('viewer-1'), ['write'], 'gtom_ingest')).toBe(false);
    expect(manager.authorize(manager.getPrincipal('operator-1'), ['write'], 'gtom_ingest')).toBe(true);
    expect(hashToken('unit-token-value')).toMatch(/^[a-f0-9]{16}$/);
  });

  it('rejects unsafe user-facing input', () => {
    expect(() => sanitizeUserString('bad\u0000value', { fieldName: 'content' })).toThrow(/control characters/);
    expect(() => sanitizeIdentifier('../bad', 'scope')).toThrow(/may only contain/);
    expect(() => sanitizeUrl('file:///tmp/secret', '--gbrain')).toThrow(/http or https/);
    expect(() => sanitizeJsonValue({ safe: ['ok'] })).not.toThrow();
  });

  it('applies fixed-window rate limits', () => {
    const limiter = new FixedWindowRateLimiter(2, 10);

    expect(limiter.check('client-1', 1000).allowed).toBe(true);
    expect(limiter.check('client-1', 1001).allowed).toBe(true);
    expect(limiter.check('client-1', 1002).allowed).toBe(false);
    expect(limiter.check('client-1', 61_001).allowed).toBe(true);
  });

  it('records redacted security audit events', () => {
    const audit = new LocalAuditLogger('gtom', tmpDir);
    audit.recordSecurityEvent({
      event_type: 'auth_failed',
      actor: 'user@example.com',
      resource: 'gtom_ingest',
      metadata: {
        api_key: 'unit-secret-value',
      },
    });

    const files = fs.readdirSync(path.join(tmpDir, '.gtom', 'audit'));
    const content = fs.readFileSync(path.join(tmpDir, '.gtom', 'audit', files[0]), 'utf8');
    expect(content).toContain('auth_failed');
    expect(content).not.toContain('user@example.com');
    expect(content).not.toContain('unit-secret-value');
  });
});
