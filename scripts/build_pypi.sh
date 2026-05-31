#!/usr/bin/env bash
#
# Regenerate the PyPI artifacts for the `gtom` CLI.
#
# Strategy: bundle the built Node CLI into one self-contained JS file with
# esbuild, ship it (plus the tiktoken wasm sidecar) as package data inside a
# Python wheel, and launch it via the user's Node.js (>= 18) at runtime.
#
# Usage:  bash scripts/build_pypi.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="${ROOT}/python/gtom/_bundle"

echo "==> [1/5] Install npm deps (skip native better-sqlite3 build)"
# --ignore-scripts avoids requiring an MSVC/C++ toolchain for better-sqlite3.
npm install --ignore-scripts

echo "==> [2/5] Build TypeScript -> dist/"
npm run build

echo "==> [3/5] Bundle CLI with esbuild -> ${BUNDLE_DIR}/gtom.cli.js"
mkdir -p "${BUNDLE_DIR}"
# better-sqlite3 is the ONLY external: it is native (needs a C++ toolchain) and
# is optional at runtime (lazy require with an in-memory fallback).
npx esbuild "${ROOT}/dist/cli.js" \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="${BUNDLE_DIR}/gtom.cli.js" \
  --external:better-sqlite3

echo "==> [4/5] Copy tiktoken wasm sidecar next to the bundle"
# The bundled tiktoken loader looks for tiktoken_bg.wasm in __dirname first.
cp "${ROOT}/node_modules/tiktoken/tiktoken_bg.wasm" "${BUNDLE_DIR}/tiktoken_bg.wasm"

echo "==> [5/5] Build sdist + wheel"
cd "${ROOT}/python"
python -m build
python -m twine check dist/*

echo "Done. Artifacts in python/dist/"
