/**
 * Export command for GToM
 * Export vulnerabilities and assessments
 */

import { Command } from './command-registry.js';
import { exportPersistenceSnapshot } from '../core/persistence-tools.js';

export const exportCommand: Command = {
  name: 'export',
  description: 'Export vulnerabilities and assessments',
  handler: async (args: string[]) => {
    const format = args[0] || 'json';
    if (format !== 'json') {
      throw new Error('Only json export is supported');
    }
    const snapshot = await exportPersistenceSnapshot();
    console.log(JSON.stringify(snapshot, null, 2));
  },
  subcommands: [
    {
      name: 'vulnerabilities',
      description: 'Export vulnerabilities',
      handler: async (args: string[]) => {
        const format = args[0] || 'json';
        if (format !== 'json') {
          throw new Error('Only json export is supported');
        }
        const snapshot = await exportPersistenceSnapshot();
        console.log(JSON.stringify({ vulnerabilities: (snapshot as any).vulnerabilities ?? [] }, null, 2));
      },
    },
    {
      name: 'assessments',
      description: 'Export assessments',
      handler: async (args: string[]) => {
        const format = args[0] || 'json';
        if (format !== 'json') {
          throw new Error('Only json export is supported');
        }
        const snapshot = await exportPersistenceSnapshot();
        console.log(JSON.stringify({ receipts: snapshot.receipts }, null, 2));
      },
    },
  ],
};
