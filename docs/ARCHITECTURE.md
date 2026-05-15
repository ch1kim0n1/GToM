# GToM Architecture

## System Overview

GToM (Theory of Mind) is a vulnerability detection and authenticity assessment system focused on security and trust.

## Core Components

### VulnerabilityRegistry
- Tracks security vulnerabilities
- Manages vulnerability lifecycle
- Supports severity classification

### AuthenticityRegistry
- Manages authenticity assessments
- Tracks content provenance
- Provides confidence scores

### ToMModel
- Implements Theory of Mind reasoning
- Analyzes beliefs and intentions
- Generates ToM inferences

### VulnerabilityScanner
- Scans code for vulnerabilities
- Performs static analysis
- Generates security reports

### AuthenticityAnalyzer
- Analyzes content authenticity
- Evaluates multiple authenticity factors
- Provides comprehensive assessments

## Database Architecture

Engine abstraction supporting:
- SQLite (default)
- PostgreSQL (production)
- In-memory (testing)

### Schema
- vulnerabilities: Security findings
- authenticity_assessments: Trust evaluations
- tom_inferences: ToM reasoning results
- scan_results: Analysis reports

## Data Flow

```
Target Selection → Vulnerability Scan → Authenticity Analysis → ToM Reasoning → Assessment Generation
```

## Security

- OAuth 2.0 authentication
- Encrypted vulnerability storage
- Access control for sensitive data
- Audit logging for security events

## Performance

- Parallel scanning
- Caching of scan results
- Incremental analysis
- Optimized ToM inference
