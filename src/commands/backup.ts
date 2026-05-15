/**
 * Backup command for GToM
 * Backup state and data
 */

import { Command } from './command-registry.js';

export const backupCommand: Command = {
  name: 'backup',
  description: 'Backup GToM state and data',
  handler: async (args: string[]) => {
    const path = args[0];
    console.log(`Backing up GToM data${path ? ` to ${path}` : ''}...`);
  },
  subcommands: [
    {
      name: 'restore',
      description: 'Restore from backup',
      handler: async (args: string[]) => {
        const path = args[0];
        if (!path) {
          console.error('Error: Missing backup path');
          return;
        }
        console.log(`Restoring from ${path}...`);
      },
    },
  ],
};
