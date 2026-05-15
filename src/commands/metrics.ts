/**
 * Metrics command for GToM
 * View and export metrics
 */

import { Command } from './command-registry.js';
import { GToM } from '../core/gtom.js';

export const metricsCommand: Command = {
  name: 'metrics',
  description: 'View and export metrics',
  handler: async (args: string[]) => {
    const format = args[0] || 'json';
    const gtom = new GToM();
    const metrics = gtom.exportMetrics(format as any);
    console.log(typeof metrics === 'string' ? metrics : JSON.stringify(metrics, null, 2));
  },
  subcommands: [
    {
      name: 'export',
      description: 'Export metrics',
      handler: async (args: string[]) => {
        const format = args[0] || 'json';
        const gtom = new GToM();
        const metrics = gtom.exportMetrics(format as any);
        console.log(typeof metrics === 'string' ? metrics : JSON.stringify(metrics, null, 2));
      },
    },
  ],
};
