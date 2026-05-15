/**
 * Backup command for GToM
 * Backup state and data
 */

import { Command } from './command-registry.js';
import { createBackup, restoreBackup } from '../core/persistence-tools.js';

export const backupCommand: Command = {
  name: 'backup',
  description: 'Backup GToM state and data',
  handler: async (args: string[]) => {
    const outputDir = args[0];
    const result = await createBackup({ outputDir });
    console.log(JSON.stringify(result, null, 2));
  },
  subcommands: [
    {
      name: 'restore',
      description: 'Restore from backup',
      handler: async (args: string[]) => {
        const backupDir = args[0];
        if (!backupDir) {
          console.error('Error: Missing backup path');
          return;
        }
        const result = await restoreBackup({ backupDir });
        console.log(JSON.stringify(result, null, 2));
      },
    },
  ],
};
