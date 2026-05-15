/**
 * Help command for GToM
 * Display help information
 */

import { Command } from './command-registry.js';
import { getAllCommands } from './command-registry.js';

export const helpCommand: Command = {
  name: 'help',
  description: 'Display help information',
  handler: async () => {
    console.log('GToM - Theory of Mind and vulnerability tracking');
    console.log('');
    console.log('Usage: gtom <command> [subcommand] [options]');
    console.log('');
    console.log('Available commands:');
    const commands = getAllCommands();
    for (const cmd of commands) {
      console.log(`  ${cmd.name.padEnd(20)} ${cmd.description}`);
    }
    console.log('');
    console.log('For more information on a specific command:');
    console.log('  gtom <command> --help');
  },
  aliases: ['--help', '-h'],
};
