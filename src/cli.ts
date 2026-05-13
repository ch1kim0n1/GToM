#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { GToM } from './core/gtom.js';

const program = new Command();

program
  .name('gtom')
  .description('Cognitive defense and Theory of Mind system')
  .version('0.1.0');

// Ingest observation
program
  .command('ingest')
  .description('Ingest an observation and update cognitive state')
  .requiredOption('-c, --content <text>', 'Observation content')
  .option('-s, --surface <name>', 'Surface name', 'ui')
  .option('--source <type>', 'Source type (user_input, agent_action, system_event, external_signal)', 'user_input')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue.bold('[GToM] Ingesting observation'));
    }

    // Basic input validation
    if (!options.content || typeof options.content !== 'string' || options.content.trim().length === 0) {
      console.error(chalk.red('Error: Content must be a non-empty string'));
      process.exit(1);
    }

    if (options.content.length > 10000) {
      console.error(chalk.red('Error: Content too long (max 10000 characters)'));
      process.exit(1);
    }

    if (options.content.includes('\0')) {
      console.error(chalk.red('Error: Content contains invalid characters'));
      process.exit(1);
    }

    const validSources = ['user_input', 'agent_action', 'system_event', 'external_signal'];
    if (options.source && !validSources.includes(options.source)) {
      console.error(chalk.red(`Error: Invalid source. Must be one of: ${validSources.join(', ')}`));
      process.exit(1);
    }

    const gtom = new GToM({
      gbrainEndpoint: options.gbrain,
    });

    try {
      await gtom.ingestObservation({
        content: options.content,
        surface: options.surface,
        source: options.source,
      });

      const vuln = gtom.getAggregateVulnerability();
      const result = {
        content: options.content,
        surface: options.surface,
        source: options.source,
        overall_vulnerability: vuln.overall,
        trend: vuln.trend,
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green('\n[GToM] Observation ingested'));
        console.log(chalk.gray(`Content: ${options.content}`));
        console.log(chalk.gray(`Surface: ${options.surface}`));
        console.log(chalk.gray(`Overall vulnerability: ${vuln.overall.toFixed(3)}`));
        console.log(chalk.gray(`Trend: ${vuln.trend}`));
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Ingestion failed:'), error);
      process.exit(1);
    }
  });

// Score decision authenticity
program
  .command('score')
  .description('Score decision authenticity')
  .requiredOption('-c, --context <text>', 'Decision context')
  .requiredOption('-a, --action <text>', 'Decision action')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue.bold('[GToM] Scoring decision authenticity'));
    }

    // Basic input validation
    if (!options.context || typeof options.context !== 'string' || options.context.trim().length === 0) {
      console.error(chalk.red('Error: Context must be a non-empty string'));
      process.exit(1);
    }

    if (!options.action || typeof options.action !== 'string' || options.action.trim().length === 0) {
      console.error(chalk.red('Error: Action must be a non-empty string'));
      process.exit(1);
    }

    if (options.context.length > 10000 || options.action.length > 10000) {
      console.error(chalk.red('Error: Context and action too long (max 10000 characters each)'));
      process.exit(1);
    }

    if (options.context.includes('\0') || options.action.includes('\0')) {
      console.error(chalk.red('Error: Input contains invalid characters'));
      process.exit(1);
    }

    const gtom = new GToM({
      gbrainEndpoint: options.gbrain,
    });

    try {
      const score = await gtom.scoreDecisionAuthenticity({
        context: options.context,
        action: options.action,
      });

      if (options.json) {
        console.log(JSON.stringify(score, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green('\n[GToM] Scoring complete'));
        console.log(chalk.gray(`Authenticity score: ${score.authenticity_score.toFixed(3)}`));
        console.log(chalk.gray(`Confidence: ${score.confidence.toFixed(3)}`));
        console.log(chalk.bold('\nFactors:'));
        console.log(`  Self-alignment: ${score.factors.self_alignment.toFixed(3)}`);
        console.log(`  External pressure: ${score.factors.external_pressure.toFixed(3)}`);
        console.log(`  Time pressure: ${score.factors.time_pressure.toFixed(3)}`);
        console.log(`  Information completeness: ${score.factors.information_completeness.toFixed(3)}`);
        console.log(`  Emotional state impact: ${score.factors.emotional_state_impact.toFixed(3)}`);
        
        if (score.manipulation_indicators.length > 0) {
          console.log(chalk.yellow('\nManipulation indicators:'));
          for (const indicator of score.manipulation_indicators) {
            console.log(`  - ${indicator}`);
          }
        }
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Scoring failed:'), error);
      process.exit(1);
    }
  });

// Self-audit
program
  .command('audit')
  .description('Perform self-audit on agent behavior')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue.bold('[GToM] Performing self-audit'));
    }

    const gtom = new GToM({
      gbrainEndpoint: options.gbrain,
    });

    try {
      // Mock agent behavior for demo
      const agentBehavior = {
        recentActions: ['explained decision', 'requested consent', 'minimized data collection'],
        userInteractions: ['user approved', 'user asked question'],
        decisions: [],
      };

      const audit = await gtom.performSelfAudit(agentBehavior);

      if (options.json) {
        console.log(JSON.stringify(audit, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green('\n[GToM] Audit complete'));
        console.log(chalk.gray(`Passed: ${audit.passed ? 'Yes' : 'No'}`));
        console.log(chalk.bold('\nScores:'));
        console.log(`  Alignment: ${audit.agent_behavior.alignment_with_user_values.toFixed(3)}`);
        console.log(`  Transparency: ${audit.agent_behavior.transparency_score.toFixed(3)}`);
        console.log(`  Consent respect: ${audit.agent_behavior.consent_respect.toFixed(3)}`);
        console.log(`  Privacy preservation: ${audit.agent_behavior.privacy_preservation.toFixed(3)}`);

        if (audit.concerns.length > 0) {
          console.log(chalk.yellow('\nConcerns:'));
          for (const concern of audit.concerns) {
            console.log(`  - ${concern}`);
          }
        }

        if (audit.recommendations.length > 0) {
          console.log(chalk.cyan('\nRecommendations:'));
          for (const rec of audit.recommendations) {
            console.log(`  - ${rec}`);
          }
        }
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Audit failed:'), error);
      process.exit(1);
    }
  });

// Get vulnerability state
program
  .command('vulnerabilities')
  .description('Get current vulnerability state')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const gtom = new GToM({
      gbrainEndpoint: options.gbrain,
    });

    const vulns = gtom.getVulnerabilities();
    const aggregate = gtom.getAggregateVulnerability();

    if (options.json) {
      console.log(JSON.stringify({ vulnerabilities: vulns, aggregate }, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.bold('Vulnerability State:'));
      console.log(chalk.gray(`Overall: ${aggregate.overall.toFixed(3)}`));
      console.log(chalk.gray(`Trend: ${aggregate.trend}`));
      console.log('');
      
      for (const vuln of vulns) {
        const level = vuln.current_level.toFixed(3);
        const delta = (vuln.current_level - vuln.baseline_level).toFixed(3);
        const deltaStr = parseFloat(delta) > 0 ? `+${delta}` : delta;
        console.log(`  ${vuln.category}: ${level} (${deltaStr})`);
      }
    }

    process.exit(0);
  });

// Health check
program
  .command('health')
  .description('Check health of GToM and dependencies')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const gtom = new GToM({
      gbrainEndpoint: options.gbrain,
    });

    const health = await gtom.healthCheck();

    if (options.json) {
      console.log(JSON.stringify(health, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.bold('GToM Health Check'));
      console.log(chalk.gray(`Status: ${health.status}`));
      console.log('');
      console.log('Components:');
      console.log(`  Vulnerability Manager: ${health.components.vulnerability_manager === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Authenticity Scorer: ${health.components.authenticity_scorer === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Cognitive ICE: ${health.components.cognitive_ice === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Conflict Predictor: ${health.components.conflict_predictor === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  GBrain: ${health.components.gbrain === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    }

    process.exit(health.status === 'healthy' ? 0 : 1);
  });

// Eval command
program
  .command('eval')
  .description('Run evaluation on a test corpus')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('-o, --output <path>', 'Write output to file (JSON format)')
  .option('--json', 'Output as JSON to stdout')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue.bold('[GToM] Running evaluation'));
    }

    const result = {
      cycles: parseInt(options.cycles),
      corpus: options.corpus,
      status: 'not_implemented',
      message: 'Eval not implemented in MVP',
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.yellow('Eval not implemented in MVP'));
    }
    process.exit(0);
  });

// Replay command
program
  .command('replay')
  .description('Replay a previous scoring run from GBrain')
  .argument('<observation-id>', 'Observation ID to replay')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (observationId: string, options) => {
    const result = {
      observation_id: observationId,
      status: 'not_implemented',
      message: 'Replay not implemented in MVP',
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.blue.bold(`[GToM] Replaying observation: ${observationId}`));
      console.log(chalk.yellow('Replay not implemented in MVP'));
    }
    process.exit(0);
  });

// Regress command
program
  .command('regress')
  .description('Compare current performance against baseline')
  .option('-b, --baseline <path>', 'Path to baseline file')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--tolerance <number>', 'Tolerance for regression detection', '0.05')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const result = {
      baseline: options.baseline,
      corpus: options.corpus,
      tolerance: parseFloat(options.tolerance),
      status: 'not_implemented',
      message: 'Regress not implemented in MVP',
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.blue.bold('[GToM] Running regression test'));
      console.log(chalk.yellow('Regress not implemented in MVP'));
    }
    process.exit(0);
  });

// Drift command
program
  .command('drift')
  .description('Check for vulnerability drift over time')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const result = {
      status: 'not_implemented',
      message: 'Drift not implemented in MVP',
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.blue.bold('[GToM] Checking for drift'));
      console.log(chalk.yellow('Drift not implemented in MVP'));
    }
    process.exit(0);
  });

// Decay command
program
  .command('decay')
  .description('Show vulnerability decay rates')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--window <hours>', 'Time window in hours', '24')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const result = {
      window: parseInt(options.window),
      status: 'not_implemented',
      message: 'Decay not implemented in MVP',
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.blue.bold('[GToM] Fetching decay rates'));
      console.log(chalk.yellow('Decay not implemented in MVP'));
    }
    process.exit(0);
  });

// Reset command
program
  .command('reset')
  .description('Reset vulnerability state to baseline')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--confirm', 'Confirm reset without prompt')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const result = {
      confirmed: options.confirm,
      status: 'not_implemented',
      message: 'Reset not implemented in MVP',
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.blue.bold('[GToM] Resetting vulnerability state'));
      console.log(chalk.yellow('Reset not implemented in MVP'));
    }
    process.exit(0);
  });

// Cost command
program
  .command('cost')
  .description('Show cost information')
  .option('--day', 'Show today\'s spend (default)')
  .option('--week', 'Show this week\'s spend')
  .option('--month', 'Show this month\'s spend')
  .option('--by-model', 'Break down by model')
  .option('--by-operation', 'Break down by operation')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const { BudgetLedger } = await import('../core/budget-ledger.js');
      const ledger = new BudgetLedger('gtom');
      await ledger.init();

      let spend = 0;
      if (options.week) {
        spend = ledger.getWeeklySpend();
      } else if (options.month) {
        spend = ledger.getMonthlySpend();
      } else {
        spend = ledger.getDailySpend();
      }

      if (options.json) {
        const breakdown = {};
        if (options.byModel) {
          breakdown['by_model'] = ledger.getSpendByModel();
        }
        if (options.byOperation) {
          breakdown['by_operation'] = ledger.getSpendByScope();
        }
        console.log(JSON.stringify({ spend, ...breakdown }, null, 2));
      } else {
        const period = options.week ? 'this week' : options.month ? 'this month' : 'today';
        console.log(chalk.blue(`LLM Spend ${period}: $${spend.toFixed(4)}`));
        
        if (options.byModel) {
          const byModel = ledger.getSpendByModel();
          console.log(chalk.gray('\nBy model:'));
          for (const [model, cost] of Object.entries(byModel)) {
            console.log(`  ${model}: $${(cost as number).toFixed(4)}`);
          }
        }
        
        if (options.byOperation) {
          const byOp = ledger.getSpendByScope();
          console.log(chalk.gray('\nBy operation:'));
          for (const [op, cost] of Object.entries(byOp)) {
            console.log(`  ${op}: $${(cost as number).toFixed(4)}`);
          }
        }
      }
      
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Cost query failed:'), error);
      process.exit(1);
    }
  });

program.parse();
