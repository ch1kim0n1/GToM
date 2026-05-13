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
    for (const tool of ['gtom_ingest', 'gtom_score', 'gtom_audit', 'gtom_vulnerabilities', 'gtom_health']) {
      expect(serverSource).toContain(tool);
    }
  });

  it('declares required schemas for scoring tools', () => {
    expect(serverSource).toContain("required: ['content']");
    expect(serverSource).toContain("required: ['context', 'action']");
  });
});
