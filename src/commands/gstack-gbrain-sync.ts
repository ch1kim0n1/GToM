#!/usr/bin/env node

import {
  GStackGBrainSync,
  type GStackGBrainSyncArgs,
  type GStackGBrainSyncMode,
} from '../core/gstack-gbrain-sync.js';

function usage(): string {
  return `Usage: gstack-gbrain-sync [--incremental|--full|--dry-run] [options]

Modes:
  --incremental        Default. Register and sync changed sources.
  --full               Reindex code sources.
  --dry-run            Preview work without writing lock, state, or source files.

Options:
  --quiet              Suppress child command output.
  --no-code            Skip the current-repo code stage.
  --no-tools           Skip the five-tool source stage.
  --help               Show this text.
`;
}

export function parseGStackGBrainSyncArgs(argv: string[]): GStackGBrainSyncArgs {
  let mode: GStackGBrainSyncMode = 'incremental';
  const parsed: GStackGBrainSyncArgs = { mode };

  for (const arg of argv) {
    switch (arg) {
      case '--incremental':
        mode = 'incremental';
        parsed.mode = mode;
        break;
      case '--full':
        mode = 'full';
        parsed.mode = mode;
        break;
      case '--dry-run':
        mode = 'dry-run';
        parsed.mode = mode;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--no-code':
        parsed.noCode = true;
        break;
      case '--no-tools':
        parsed.noTools = true;
        break;
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  return parsed;
}

export async function runGStackGBrainSyncCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseGStackGBrainSyncArgs(argv);
  const sync = new GStackGBrainSync();
  const result = await sync.run(args);
  if (!args.quiet || args.mode === 'dry-run') {
    console.log(sync.format(result.stages, args.mode));
  }
  return result.exitCode;
}

if (require.main === module) {
  runGStackGBrainSyncCli()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`gstack-gbrain-sync fatal: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
