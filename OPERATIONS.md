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
gtom assess --context "user context" --action "user action" --content "content"
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

Cognitive states, vulnerability histories, and influence logs are stored in GBrain. Backup GBrain according to its operational guide.
