# Data Flow

```mermaid
flowchart LR
  CLI["CLI / HTTP / MCP"] --> GToM["GToM core"]
  GToM --> VM["VulnerabilityManager"]
  GToM --> AS["AuthenticityScorer"]
  GToM --> CP["ConflictPredictor"]
  GToM --> ICE["Cognitive ICE"]
  AS --> LLM["LLM providers"]
  GToM --> GB["GBrain"]
  GToM --> RR["ReceiptRegistry"]
  GToM --> BL["BudgetLedger"]
  GToM --> OBS["Observability"]
  RR --> FS["JSONL receipts"]
  RR --> PG["Postgres mirror"]
  BL --> AUD["Audit JSONL"]
  OBS --> PROM["Prometheus / OTel"]
```

## Notes

- Public calls are timed and traced.
- Decisions and shell jobs are audit logged.
- Receipts are signed before storage.
- Health checks combine local probes, remote probes, schema, queue, and freshness status.
