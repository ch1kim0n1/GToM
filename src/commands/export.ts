/**
 * Export command for GToM
 * Export vulnerabilities and assessments
 */

import { Command } from './command-registry.js';

export const exportCommand: Command = {
  name: 'export',
  description: 'Export vulnerabilities and assessments',
  handler: async (args: string[]) => {
    console.log('Export data');
  },
  subcommands: [
    {
      name: 'vulnerabilities',
      description: 'Export vulnerabilities',
      handler: async (args: string[]) => {
        const format = args[0] || 'json';
        console.log(`Exporting vulnerabilities as ${format}...`);
      },
    },
    {
      name: 'assessments',
      description: 'Export assessments',
      handler: async (args: string[]) => {
        const format = args[0] || 'json';
        console.log(`Exporting assessments as ${format}...`);
      },
    },
  ],
};
