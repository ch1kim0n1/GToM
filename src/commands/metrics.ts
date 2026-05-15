/**
 * Metrics command for GToM
 * View and export metrics
 */

import { Command } from './command-registry.js';

export const metricsCommand: Command = {
  name: 'metrics',
  description: 'View and export metrics',
  handler: async (args: string[]) => {
    console.log('GToM metrics:');
    console.log('  Total vulnerabilities: 0');
    console.log('  Total assessments: 0');
  },
  subcommands: [
    {
      name: 'export',
      description: 'Export metrics',
      handler: async (args: string[]) => {
        const format = args[0] || 'json';
        console.log(`Exporting metrics as ${format}...`);
      },
    },
  ],
};
