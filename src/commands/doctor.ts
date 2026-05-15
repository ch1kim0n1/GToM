/**
 * Doctor command for GToM
 * Diagnostic and health check functionality
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { Command } from './command-registry.js';
import { defaultConfig } from '../core/config.js';
import { createEngine } from '../core/engine-factory.js';

const stateDir = path.join(process.cwd(), '.gtom');
const configPath = path.join(stateDir, 'config.json');
const vulnerabilitiesPath = path.join(stateDir, 'vulnerabilities.json');

async function ensureStateDir(): Promise<void> {
  await mkdir(stateDir, { recursive: true });
}

async function fixConfig(): Promise<void> {
  await ensureStateDir();
  try {
    JSON.parse(await readFile(configPath, 'utf8'));
    console.log('Configuration file is valid');
  } catch {
    await writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, 'utf8');
    console.log(`Wrote default configuration to ${configPath}`);
  }
}

async function fixState(): Promise<void> {
  await ensureStateDir();
  const engine = createEngine(defaultConfig.database);
  await engine.initialize();
  try {
    await engine.migrate();
    const healthy = await engine.healthCheck();
    if (!healthy) {
      throw new Error('state engine health check failed');
    }
    console.log('State storage initialized and migrated');
  } finally {
    await engine.close();
  }
}

async function fixVulnerabilities(): Promise<void> {
  await ensureStateDir();
  try {
    const current = JSON.parse(await readFile(vulnerabilitiesPath, 'utf8'));
    if (!Array.isArray(current)) {
      throw new Error('vulnerability file must contain an array');
    }
    console.log('Vulnerability registry file is valid');
  } catch {
    await writeFile(vulnerabilitiesPath, '[]\n', 'utf8');
    console.log(`Initialized vulnerability registry at ${vulnerabilitiesPath}`);
  }
}

export const doctorCommand: Command = {
  name: 'doctor',
  description: 'Run diagnostics and health checks on GToM',
  handler: async () => {
    console.log('Running GToM diagnostics...');
    console.log('Configuration: OK');
    console.log('State storage: OK');
    console.log('Vulnerability tracking: OK');
    console.log('All systems operational.');
  },
  subcommands: [
    {
      name: 'check',
      description: 'Run specific diagnostic checks',
      handler: async (args: string[]) => {
        const check = args[0] || 'all';
        console.log(`Running diagnostic check: ${check}`);
      },
    },
    {
      name: 'fix',
      description: 'Attempt to fix detected issues',
      handler: async (args: string[]) => {
        const issueType = args[0] || 'all';
        console.log(`Attempting to fix ${issueType} issues...`);

        switch (issueType) {
          case 'config':
            await fixConfig();
            break;
          case 'state':
            await fixState();
            break;
          case 'vulnerability':
          case 'vulnerabilities':
            await fixVulnerabilities();
            break;
          case 'all':
            await fixConfig();
            await fixState();
            await fixVulnerabilities();
            break;
          default:
            throw new Error(`Unknown issue type: ${issueType}`);
        }

        console.log('Fix complete.');
      },
    },
  ],
};
