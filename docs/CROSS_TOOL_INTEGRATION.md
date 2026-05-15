# Cross-Tool Integration

GToM exposes a lightweight cross-tool integration layer for local and test workflows.

## Event Bus

`InProcessCrossToolEventBus` provides pub/sub semantics for the G-Stack pipeline without requiring Redis. It is intentionally small: callers publish typed events, subscribe by topic or `*`, and can replay events by task id. The interface can be adapted to Redis pub/sub later without changing pipeline callers.

## Service Discovery

`CrossToolServiceDiscovery.fromWorkspace()` discovers the five expected tools from a shared workspace:

1. `gorchestrator`
2. `gmirror`
3. `GToM`
4. `glearn`
5. `gagent`

Each service descriptor includes the tool name, root path, package path, optional endpoint, and `available` or `missing` status.

## Single-Task Pipeline

`runCrossToolTask()` emits the canonical task path:

```text
gorchestrator -> gmirror -> GToM -> glearn -> gagent
```

The integration test in `test/cross-tool-integration.test.ts` creates all five service roots, runs a single task through the event bus, and asserts the full event order.
