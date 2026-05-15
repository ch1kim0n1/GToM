# GToM Operations Guide

## Deployment

### Prerequisites
- Node.js >= 18
- GBrain endpoint accessible

### Installation
```bash
npm install
npm run build
npm link
```

### Deployment Methods

#### Docker Compose
```bash
# Build and start with Docker Compose
docker-compose up -d gtom

# View logs
docker-compose logs -f gtom

# Stop
docker-compose down
```

#### Kubernetes with Helm
```bash
# Add Helm repository (if applicable)
# helm repo add gstack https://...

# Install chart
helm install gtom ./helm/gtom --namespace gstack --create-namespace

# Upgrade
helm upgrade gtom ./helm/gtom --namespace gstack

# Rollback
helm rollback gtom --namespace gstack

# Uninstall
helm uninstall gtom --namespace gstack
```

#### Rolling Upgrade

```bash
docker build -f GToM/Dockerfile -t gtom:<version> .
helm upgrade gtom ./GToM/helm/gtom --namespace gstack --set image.tag=<version> --wait
kubectl rollout status deployment/gtom -n gstack
```

The readiness probe returns `503` while a pod is draining, so Kubernetes stops sending new traffic before SIGTERM completes. Keep `terminationGracePeriodSeconds` greater than `GTOM_SHUTDOWN_DRAIN_TIMEOUT_MS`.

#### Canary Deployment

```bash
kubectl apply -f GToM/k8s/canary.yaml -n gstack
kubectl set image deployment/gtom-canary gtom=gtom:<candidate> -n gstack
kubectl rollout status deployment/gtom-canary -n gstack
```

Route a small percentage of traffic to `gtom-canary`, compare `gtom_method_errors_total`, latency, and tenant quota rejects, then promote the same image tag to the primary Helm release.

#### Blue/Green Deployment

```bash
kubectl apply -f GToM/k8s/blue-green.yaml -n gstack
kubectl scale deployment/gtom-green --replicas=2 -n gstack
kubectl set image deployment/gtom-green gtom=gtom:<candidate> -n gstack
kubectl patch service gtom-active -n gstack -p '{"spec":{"selector":{"app":"gtom","track":"green"}}}'
```

Keep the previous color scaled until the new color has passed readiness and error-budget checks.

#### Systemd (Bare Metal)
```bash
# Create user and directories
sudo useradd -r -s /bin/false gtom
sudo mkdir -p /opt/gtom /var/lib/gtom /var/log/gtom /etc/gtom
sudo chown -R gtom:gtom /opt/gtom /var/lib/gtom /var/log/gtom

# Copy files
sudo cp -r dist/* /opt/gtom/
sudo cp deploy/systemd/gtom.service /etc/systemd/system/
sudo cp .env.example /etc/gtom/gtom.env
# Edit /etc/gtom/gtom.env with actual values

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable gtom
sudo systemctl start gtom

# Check status
sudo systemctl status gtom
sudo journalctl -u gtom -f
```

### Rollback Procedures

#### Kubernetes
```bash
# View revision history
helm history gtom --namespace gstack

# Rollback to previous version
helm rollback gtom --namespace gstack

# Rollback to specific revision
helm rollback gtom <revision> --namespace gstack

# Blue/green immediate switchback
kubectl patch service gtom-active -n gstack -p '{"spec":{"selector":{"app":"gtom","track":"blue"}}}'
```

#### Docker Compose
```bash
# Rebuild with previous image tag
docker-compose down
docker-compose up -d --build gtom
```

#### Systemd
```bash
# Stop service
sudo systemctl stop gtom

# Restore previous build
sudo cp -r /opt/gtom.backup/* /opt/gtom/

# Restart
sudo systemctl start gtom
```

### Configuration
Create `~/.gtom/config.json`:

```json
{
  "endpoints": {
    "gbrain": "http://localhost:3000"
  },
  "vulnerability": {
    "alertThreshold": 0.7
  },
  "ice": {
    "sensitivity": "medium"
  }
}
```

## Running

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
gtom ingest --content "Only 2 seats left" --surface checkout
gtom score --context "user context" --action "user action"
```

### MCP Server Mode
```bash
gtom mcp
```

## Monitoring

### Health Checks
```bash
gtom health
```

### Service Level Objectives (SLOs)

#### P95 Latency
- Assess operation: 500ms
- Health check: 100ms

#### Error Rate
- Assess operation: < 1% (5xx errors)
- Health check: < 0.1%

#### Uptime
- Monthly: 99.5%
- Quarterly: 99.9%

#### Alert Thresholds
- P95 latency > 1s for 5 minutes
- Error rate > 5% for 5 minutes
- Health check failure for 1 minute
- Tenant quota rejects > 10% of requests for 5 minutes

Checks:
- GBrain connectivity
- Vulnerability tracking status
- ICE alert system status

### Metrics to Track
- Average authenticity scores
- Vulnerability distribution
- ICE alert frequency
- Influence exposure rate
- Cognitive state updates
- `gtom_method_calls_total`
- `gtom_method_errors_total`
- `gtom_method_latency_ms`

### Metrics Export
```bash
gtom metrics --format prometheus
curl -s http://localhost:3003/metrics
curl -s http://localhost:3003/metrics/otel
```

## Per-Tenant Quotas

GToM enforces both caller and tenant fixed-window quotas.

- Caller quota: `GTOM_HTTP_RATE_LIMIT_RPM`, `GTOM_HTTP_RATE_LIMIT_RPH`
- Tenant quota: `GTOM_TENANT_RATE_LIMIT_RPM`, `GTOM_TENANT_RATE_LIMIT_RPH`
- Tenant identity headers: `X-Tenant-Id`, then `X-GStack-Tenant`, then `default`
- Response headers: `X-Tenant-Id`, `X-Tenant-RateLimit-Remaining`, `X-Tenant-RateLimit-Reset`

Tenant quota failures return HTTP `429` with `Tenant quota exceeded` and emit a `tenant_quota_exceeded` security audit event.

## Troubleshooting

### GBrain Unavailable
- System falls back to in-memory tracking
- Logs warning but continues operation
- Check GBrain endpoint and connectivity

### High Alert Volume
- Review ICE sensitivity setting
- Check vulnerability thresholds
- Verify influence tracking window

### Low Authenticity Scores
- Review recent influence exposures
- Check current vulnerability levels
- Verify cognitive load measurements

## Maintenance

### Cleanup
```bash
# Archive old influence logs (via GBrain)
# Prune vulnerability history
```

### Updates
```bash
npm install
npm run build
```

## Backup

```bash
gtom backup --output-dir ./.gtom/backups --rotate 10 --json
gtom export --format json --json
```

Restore:

```bash
gtom restore --backup-dir ./.gtom/backups/<backup-name> --json
```
