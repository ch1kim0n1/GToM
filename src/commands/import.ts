/**
 * Import command for GToM
 * Import vulnerabilities and assessments
 */

import { Command } from './command-registry.js';

export const importCommand: Command = {
  name: 'import',
  description: 'Import vulnerabilities and assessments',
  handler: async (args: string[]) => {
    console.log('Import data');
  },
  subcommands: [
    {
      name: 'vulnerability',
      description: 'Import vulnerability from file',
      handler: async (args: string[]) => {
        const filepath = args[0];
        if (!filepath) {
          console.error('Error: Missing file path');
          return;
        }
        console.log(`Importing vulnerability from ${filepath}...`);
      },
    },
  ],
};
