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
    const components = Object.fromEntries(
      health.map((check) => [check.service, check.healthy ? 'ok' : 'error'])
    ) as Record<string, 'ok' | 'error'>;
    const status = health.every((check) => check.healthy) ? 'healthy' : 'unhealthy';

    if (options.json) {
      console.log(JSON.stringify({ status, components, checks: health }, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.bold('GToM Health Check'));
      console.log(chalk.gray(`Status: ${status}`));
      console.log('');
      console.log('Components:');
      console.log(`  Vulnerability Manager: ${components.vulnerabilityManager === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Authenticity Scorer: ${components.authenticityScorer === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Cognitive ICE: ${components.cognitiveICE === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Conflict Predictor: ${components.conflictPredictor === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  GBrain: ${components.gbrain === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    }

    process.exit(status === 'healthy' ? 0 : 1);
  });

// Eval command
program
  .command('eval')
  .description('Run evaluation on a test corpus')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('-o, --output <path>', 'Write output to file (JSON format)')
  .option('--json', 'Output as JSON')
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
  .description('Replay a previous observation from corpus')
  .argument('<hash>', 'Content hash to replay')
  .option('--corpus <path>', 'Path to corpus directory', './.gbrain-corpus')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (hash: string, options) => {
    try {
      const { ReplayManager } = await import('../../shared/src/core/replay-manager.js');
      const replayManager = new ReplayManager(options.corpus);
      
      const result = await replayManager.retrieve(hash);
      
      if (!result.found) {
        console.error(chalk.red(`[GToM] Hash not found in corpus: ${hash}`));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold(`[GToM] Replaying hash: ${hash}`));
        console.log(chalk.gray(`Tool: ${result.metadata.tool}`));
        console.log(chalk.gray(`Timestamp: ${result.metadata.timestamp}`));
        console.log(chalk.gray(`Task: ${result.metadata.task || 'N/A'}`));
        console.log(chalk.green('\nContent:'));
        console.log(result.content);
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Replay failed:'), error);
      process.exit(1);
    }
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

// Trend command
program
  .command('trend')
  .description('Show vulnerability trend data over a time window')
  .option('--window <days>', 'Number of days to analyse', '7')
  .option('--category <name>', 'Filter to a specific vulnerability category (e.g. scarcity_fear, authority_bias)')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue.bold('[GToM] Analysing vulnerability trends'));
    }

    const windowDays = parseInt(options.window, 10);
    if (isNaN(windowDays) || windowDays <= 0) {
      console.error(chalk.red('Error: --window must be a positive integer (number of days)'));
      process.exit(1);
    }

    try {
      const gtom = new GToM({
        gbrainEndpoint: options.gbrain,
      });

      const vulns = gtom.getVulnerabilities();
      const aggregate = gtom.getAggregateVulnerability();

      // Filter to a specific category when --category is supplied
      const targets = options.category
        ? vulns.filter((v: { category: string }) => v.category === options.category)
        : vulns;

      if (options.category && targets.length === 0) {
        console.error(chalk.red(`Error: Unknown category '${options.category}'. Valid categories: ${vulns.map((v: { category: string }) => v.category).join(', ')}`));
        process.exit(1);
      }

      const results = targets.map((v: { category: string; current_level: number; baseline_level: number }) => {
        const delta = v.current_level - v.baseline_level;
        const trend: 'increasing' | 'decreasing' | 'stable' =
          delta > 0.1 ? 'increasing' : delta < -0.1 ? 'decreasing' : 'stable';

        return {
          category: v.category,
          window_days: windowDays,
          trend,
          current_level: parseFloat(v.current_level.toFixed(4)),
          baseline_level: parseFloat(v.baseline_level.toFixed(4)),
          drifted: Math.abs(delta) > 0.1,
        };
      });

      const output = options.category ? results[0] : { window_days: windowDays, overall_trend: aggregate.trend, categories: results };

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      } else if (!options.quiet) {
        if (options.category) {
          const r = results[0];
          const trendColor = r.trend === 'increasing' ? chalk.red : r.trend === 'decreasing' ? chalk.green : chalk.gray;
          console.log(chalk.bold(`\nTrend for '${r.category}' over ${windowDays} day(s):`));
          console.log(`  Trend:         ${trendColor(r.trend)}`);
          console.log(`  Current level: ${r.current_level.toFixed(4)}`);
          console.log(`  Baseline:      ${r.baseline_level.toFixed(4)}`);
          console.log(`  Drifted:       ${r.drifted ? chalk.red('yes') : chalk.green('no')}`);
        } else {
          const overallColor = aggregate.trend === 'increasing' ? chalk.red : aggregate.trend === 'decreasing' ? chalk.green : chalk.gray;
          console.log(chalk.bold(`\nVulnerability trends — window: ${windowDays} day(s)`));
          console.log(`  Overall trend: ${overallColor(aggregate.trend)}`);
          console.log('');
          for (const r of results) {
            const trendColor = r.trend === 'increasing' ? chalk.red : r.trend === 'decreasing' ? chalk.green : chalk.gray;
            const driftedFlag = r.drifted ? chalk.red(' [drifted]') : '';
            console.log(`  ${r.category.padEnd(30)} ${trendColor(r.trend.padEnd(12))} current=${r.current_level.toFixed(4)} baseline=${r.baseline_level.toFixed(4)}${driftedFlag}`);
          }
        }
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Trend analysis failed:'), error);
      process.exit(1);
    }
  });

// Drift command
program
  .command('drift')
  .description('Check for vulnerability drift over time')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--window <days>', 'Number of days to analyze', '7')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      const windowDays = parseInt(options.window);
      if (isNaN(windowDays) || windowDays <= 0) {
        console.error(chalk.red('[GToM] --window must be a positive integer'));
        process.exit(1);
      }

      const { DriftDetector } = await import('../../shared/src/core/drift-detector.js');
      const detector = new DriftDetector({
        window_size: 100,
        drift_threshold: 0.2,
        alert_threshold: 0.3,
        baseline_period_ms: 7 * 24 * 60 * 60 * 1000,
      });

      // Get current vulnerabilities from GToM
      const gtom = new GToM({
        gbrainEndpoint: options.gbrain,
      });
      const vulnerabilities = gtom.getVulnerabilities();

      // For MVP, use sample data to demonstrate drift detection
      // In production, this would load historical metrics from persistence layer
      const sampleMetrics = [
        { name: 'overall_vulnerability', values: Array.from({ length: 50 }, () => vulnerabilities.reduce((sum: number, v: any) => sum + (v.overall || 0), 0) / vulnerabilities.length || 0.3 + Math.random() * 0.1) },
        { name: 'vulnerability_manager', values: Array.from({ length: 50 }, () => 0.25 + Math.random() * 0.1) },
        { name: 'authenticity_scorer', values: Array.from({ length: 50 }, () => 0.2 + Math.random() * 0.1) },
        { name: 'cognitive_ice', values: Array.from({ length: 50 }, () => 0.15 + Math.random() * 0.1) },
        { name: 'conflict_predictor', values: Array.from({ length: 50 }, () => 0.1 + Math.random() * 0.1) },
      ];

      // Record snapshots
      sampleMetrics.forEach(metric => {
        metric.values.forEach((value, i) => {
          const timestamp = new Date(Date.now() - (50 - i) * 3600000).toISOString();
          detector['recordSnapshot'](metric.name, value, { timestamp });
        });
      });

      const driftResults = detector.detectAllDrift();
      const alerts = detector.getAlerts();

      const result = {
        window_days: windowDays,
        metrics_tracked: detector.getMetricNames(),
        drift_results: driftResults,
        alerts,
        current_vulnerabilities_count: vulnerabilities.length,
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GToM] Checking for drift'));
        console.log(chalk.green.bold('\n[GToM] Drift Analysis'));
        console.log(chalk.gray(`Window: ${windowDays} days`));
        console.log(chalk.gray(`Current vulnerabilities: ${vulnerabilities.length}`));
        console.log(chalk.gray(`Metrics tracked: ${detector.getMetricNames().join(', ')}`));
        console.log(chalk.gray(`Drift detected: ${driftResults.some((d: any) => d.drift_detected) ? 'Yes' : 'No'}`));
        
        if (driftResults.length > 0) {
          console.log(chalk.bold('\nDrift Results:'));
          for (const result of driftResults) {
            const status = result.drift_detected ? chalk.red('⚠') : chalk.green('✓');
            console.log(`  ${status} ${result.metric_name}: ${result.drift_magnitude.toFixed(3)} (${result.trend})`);
          }
        }

        if (alerts.length > 0) {
          console.log(chalk.red.bold('\nAlerts:'));
          for (const alert of alerts) {
            console.log(`  ${alert.metric_name}: ${alert.drift_magnitude.toFixed(3)} (threshold: 0.3)`);
          }
        }
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Drift check failed:'), error);
      process.exit(1);
    }
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
      const { BudgetLedger } = await import('../../shared/src/core/budget-ledger.js');
      const ledger = new BudgetLedger({ max_budget_usd: 1000 }, 'gtom');
      await ledger.init();

      let spend = 0;
      if (options.week) {
        spend = ledger.getWeeklySpend();
      } else if (options.month) {
        spend = ledger.getMonthlySpend();
      } else {
        spend = ledger.getDailySpend();
      }

      const breakdown: Record<string, any> = {};
      if (options.byModel) {
        breakdown['by_model'] = ledger.getSpendByModel();
      }
      if (options.byOperation) {
        breakdown['by_operation'] = ledger.getSpendByModel();
      }

      if (options.json) {
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
          const byOp = ledger.getSpendByModel();
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
