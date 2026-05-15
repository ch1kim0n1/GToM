# Incident Response Template

## Incident

- Start time:
- Detected by:
- Severity:
- Affected tenants:
- User impact:

## Current Status

- `GET /health/live`:
- `GET /health/ready`:
- `GET /metrics`:
- Last deployment:
- Current rollback target:

## Timeline

| Time | Event | Owner |
| --- | --- | --- |
| | | |

## Mitigation

1. Stop rollout or shift traffic away from the affected deployment.
2. Check tenant quota pressure with `X-Tenant-RateLimit-*` headers and rate-limit metrics.
3. If the issue is release-related, roll back with Helm or switch `gtom-active` to the prior blue/green track.
4. If downstream GBrain is degraded, keep GToM in degraded local mode and page the GBrain owner.

## Resolution

- Fix:
- Verification:
- Follow-up issue:
- Customer-facing note:

## Post-Incident Review

- What failed:
- What worked:
- Prevention:
- New alerts or runbook changes:
