# GToM Testing Guide

## Test Structure

```
test/
├── vulnerability.test.ts   # VulnerabilityManager tests
├── authenticity.test.ts   # AuthenticityScorer tests
├── ice-conflict.test.ts    # ICE conflict detection tests
└── gtom.test.ts           # GToM integration tests
```

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npm test vulnerability.test.ts
```

## Test Categories

### Unit Tests

**VulnerabilityManager** (`test/vulnerability.test.ts`)
- Initializes 10 vulnerability categories at baseline 0.5
- Process observation on authority content raises authority_bias
- Process observation on scarcity content raises scarcity_fear
- GetInfluenceLedger returns recorded influence events
- GetCurrentCognitiveState returns valid state after observation

**AuthenticityScorer** (`test/authenticity.test.ts`)
- Scores clean decision as highly authentic (> 0.6)
- Scores manipulated decision as less authentic (< 0.7)
- Produces score between 0 and 1 in all cases
- Reports manipulation indicators when high-severity vulnerabilities active
- Handles empty vulnerability arrays

**ICE Conflict** (`test/ice-conflict.test.ts`)
- Detects ICE conflicts between tools
- Prioritizes user protection over tool efficiency
- Generates conflict resolution proposals

## Test Data Fixtures

Test helpers create minimal valid objects:

```typescript
function makeVulnerability(category: Vulnerability['category'], level: number): Vulnerability { ... }
function makeCognitiveState(overrides?: Partial<CognitiveState>): CognitiveState { ... }
```

## Coverage Goals

- Core modules: > 90%
- Behavioral tests: > 85%
- Overall: > 85%

## Adding Tests

1. Create test file in `test/`
2. Import from `@jest/globals`
3. Use `describe`, `it`, `expect`, `beforeEach`
4. Follow existing test patterns
5. Add helpers for fixture creation

## CI Testing

```bash
npm run verify    # typecheck + test
npm run ci:local  # verify + build
```
