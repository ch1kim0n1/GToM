// GToM/test/mcp.test.ts
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('GToM MCP Server', () => {
  const serverSource = readFileSync(join(__dirname, '../src/mcp/server.ts'), 'utf8');

  it('declares the expected server identity', () => {
    expect(serverSource).toContain("name: 'gtom'");
    expect(serverSource).toContain("version: '0.1.0'");
  });

  it('declares the expected tool names', () => {
    for (const tool of [
      'gtom_ingest',
      'gtom_score',
      'gtom_audit',
      'gtom_vulnerabilities',
      'gtom_health',
      'gtom_get_drift',
      'gtom_get_authenticity_history',
      'gtom_get_indicators',
      'get_drift',
      'get_authenticity_history',
      'get_indicators',
    ]) {
      expect(serverSource).toContain(tool);
    }
  });

  it('declares required schemas for scoring tools', () => {
    expect(serverSource).toContain("required: ['content']");
    expect(serverSource).toContain("required: ['context', 'action']");
  });

  it('declares token auth, read/write scopes, and rate limiting contract', () => {
    expect(serverSource).toContain('GTOM_MCP_AUTH_REQUIRED');
    expect(serverSource).toContain('GTOM_MCP_READ_TOKEN');
    expect(serverSource).toContain('GTOM_MCP_WRITE_TOKEN');
    expect(serverSource).toContain("gtom_ingest: ['write']");
    expect(serverSource).toContain("gtom_vulnerabilities: ['read']");
    expect(serverSource).toContain('checkRateLimit');
    expect(serverSource).toContain('GTOM_RATE_LIMIT_RPM');
    expect(serverSource).toContain('GTOM_RATE_LIMIT_RPH');
  });

  it('keeps every exposed read alias mapped to scope checks', () => {
    for (const tool of ['get_drift', 'get_authenticity_history', 'get_indicators']) {
      expect(serverSource).toContain(`${tool}: ['read']`);
      expect(serverSource).toContain(`case '${tool}':`);
    }
  });
});
