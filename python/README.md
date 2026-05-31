# gtom

Cognitive defense and Theory of Mind system — detect manipulation patterns,
predict conflicts, and model cognitive/emotional state in text and agent
interactions.

This PyPI package is a convenience wrapper that ships a self-contained bundle
of the `gtom` Node.js CLI and runs it through your local Node.js runtime.

## Install from PyPI

```bash
pip install gtom
```

This installs a `gtom` command on your `PATH`. The package bundles the entire
CLI as JavaScript, so the only runtime prerequisite is **Node.js >= 18**.

- Install Node.js from <https://nodejs.org/> if you do not already have it.
- If `node` is not found, `gtom` prints a clear install hint and exits non-zero.

```bash
gtom --version
gtom --help
```

## SQLite persistence is optional

`gtom` can persist analysis history and vulnerability state to a local SQLite
database via the optional native `better-sqlite3` module. The bundled CLI does
**not** include `better-sqlite3` (it requires a C++ toolchain to compile), so
out of the box `gtom` runs in an in-memory / no-persistence mode. All core
commands (analysis, scoring, conflict prediction, `--help`, `--version`) work
without it. To enable durable SQLite persistence, install the npm package in a
Node project where `better-sqlite3` can build, or use the PostgreSQL backend.

## What is included

- `gtom.cli.js` — the bundled CLI (commander, chalk, zod, pg, tiktoken, uuid,
  proper-lockfile, and the LLM SDKs are all bundled in).
- `tiktoken_bg.wasm` — the tiktoken tokenizer WebAssembly sidecar, shipped next
  to the bundle so token counting works without any extra install.

## Links

- Homepage / source: <https://github.com/ch1kim0n1/GToM>

## License

MIT
