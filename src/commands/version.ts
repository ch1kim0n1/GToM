/**
 * Version command for GToM
 * Display version information
 */

import { Command } from './command-registry.js';

/**
 * @deprecated Use the Commander-based `gtom --version` or `gtom version-info`
 * surfaces. The legacy command-registry path is kept only for compatibility
 * and is scheduled for removal in the next major release.
 */
export const versionCommand: Command = {
  name: 'version',
  description: 'Display version information',
  handler: async () => {
    console.log('GToM version 0.1.0');
  },
  aliases: ['--version', '-v'],
};
