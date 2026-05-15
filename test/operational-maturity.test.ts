import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('operational maturity artifacts', () => {
  it('defines container, compose, Kubernetes, Helm, and systemd deployment surfaces', () => {
    expect(read('Dockerfile')).toContain('dist/serve.js');
    expect(read('docker-compose.yml')).toContain('gorchestrator:');
    expect(read('docker-compose.yml')).toContain('gmirror:');
    expect(read('docker-compose.yml')).toContain('gtom:');
    expect(read('docker-compose.yml')).toContain('glearn:');
    expect(read('docker-compose.yml')).toContain('gagent:');
    expect(read('docker-compose.yml')).toContain('gbrain:');
    expect(read('docker-compose.yml')).toContain('gstack:');
    expect(read('k8s/deployment.yaml')).toContain('/health/ready');
    expect(read('helm/gtom/templates/deployment.yaml')).toContain('/health/live');
    expect(read('deploy/systemd/gtom.service')).toContain('ExecStop=/bin/kill -TERM');
  });

  it('documents rollout, rollback, on-call, incident response, SLOs, and quotas', () => {
    expect(read('OPERATIONS.md')).toContain('Rolling Upgrade');
    expect(read('OPERATIONS.md')).toContain('Canary Deployment');
    expect(read('OPERATIONS.md')).toContain('Blue/Green Deployment');
    expect(read('OPERATIONS.md')).toContain('Rollback Procedures');
    expect(read('OPERATIONS.md')).toContain('Service Level Objectives');
    expect(read('OPERATIONS.md')).toContain('Per-Tenant Quotas');
    expect(read('docs/RUNBOOK.md')).toContain('On-Call');
    expect(read('docs/INCIDENT_RESPONSE.md')).toContain('Incident Response Template');
  });

  it('implements readiness draining and per-tenant quota headers', () => {
    const server = read('src/server.ts');
    expect(server).toContain('GTOM_SHUTDOWN_DRAIN_TIMEOUT_MS');
    expect(server).toContain('status = this.draining ?');
    expect(server).toContain('X-Tenant-RateLimit-Remaining');
    expect(server).toContain('tenant_quota_exceeded');
  });
});
