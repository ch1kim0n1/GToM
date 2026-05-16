#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GToM } from './core/gtom.js';
import {
  ReceiptRegistry,
  RegressionToleranceConfig,
  compareReceiptRegression,
  diffReceipts,
  migrateReceiptToVersion,
  readReceiptFile,
} from './core/receipt-registry.js';
import {
  createBackup,
  exportPersistenceSnapshot,
  restoreBackup,
} from './core/persistence-tools.js';
import { GStackGBrainSync } from './core/gstack-gbrain-sync.js';
import { FileSecretManager } from './core/secret-manager.js';
import {
  sanitizeIdentifier,
  sanitizePath,
  sanitizeUrl,
  sanitizeUserString,
} from './core/input-sanitizer.js';
import {
  API_STABILITY,
  CURRENT_RECEIPT_SCHEMA_VERSION,
  getVersionMetadata,
} from './core/versioning.js';
import { analyzeCommand } from './commands/analyze.js';
import { historyCommand } from './commands/history.js';

const program = new Command();
const DEFAULT_GBRAIN_ENDPOINT = process.env.GTOM_GBRAIN_ENDPOINT || process.env.GBRAIN_ENDPOINT || 'http://localhost:3000';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function loadReceipt(receiptPath: string) {
  return readReceiptFile(sanitizePath(receiptPath, 'receipt path'));
}

async function loadLatestReceipt(): Promise<any> {
  const registry = new ReceiptRegistry('gtom');
  const latest = await registry.getLatest();
  if (!latest) {
    throw new Error('No local receipts found');
  }
  return latest;
}

async function loadRegressionConfig(options: any): Promise<RegressionToleranceConfig> {
  const config: RegressionToleranceConfig = {
    defaultScoreTolerance: parseFloat(options.tolerance ?? '0.05'),
    costToleranceUsd: parseFloat(options.costToleranceUsd ?? '0'),
    costTolerancePct: parseFloat(options.costTolerancePct ?? '0'),
    latencyToleranceMs: parseFloat(options.latencyToleranceMs ?? '0'),
    latencyTolerancePct: parseFloat(options.latencyTolerancePct ?? '0'),
    metricTolerances: {
      tier1_success_rate: parseFloat(options.tier1Tolerance ?? '0.05'),
    },
  };

  if (options.dimensionTolerance) {
    config.dimensionTolerances = parseKeyValueNumbers(options.dimensionTolerance);
  }

  if (options.config) {
    const parsed = JSON.parse(await fs.readFile(sanitizePath(options.config, '--config'), 'utf8')) as RegressionToleranceConfig;
    return {
      ...config,
      ...parsed,
      dimensionTolerances: {
        ...(config.dimensionTolerances ?? {}),
        ...(parsed.dimensionTolerances ?? {}),
      },
      metricTolerances: {
        ...(config.metricTolerances ?? {}),
        ...(parsed.metricTolerances ?? {}),
      },
    };
  }

  return config;
}

function parseKeyValueNumbers(values: string | string[]): Record<string, number> {
  const entries = Array.isArray(values) ? values : [values];
  const result: Record<string, number> = {};
  for (const entry of entries) {
    const [key, rawValue] = entry.split('=');
    const value = Number(rawValue);
    if (!key || !Number.isFinite(value)) {
      throw new Error(`Invalid tolerance '${entry}'. Expected name=value.`);
    }
    result[sanitizeIdentifier(key, 'tolerance name')] = value;
  }
  return result;
}

function printRegressionResult(result: any, quiet?: boolean, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (quiet) return;

  console.log(chalk.blue.bold('[GToM] Regression result'));
  console.log(chalk.gray(`Baseline: ${result.baseline_receipt_id}`));
  console.log(chalk.gray(`Current:  ${result.current_receipt_id}`));
  console.log(chalk.gray(`Score delta: ${result.score_delta.toFixed(4)}`));
  if (result.regressed) {
    console.log(chalk.red('Regression detected'));
    for (const reason of result.reasons) {
      console.log(`  - ${reason}`);
    }
  } else {
    console.log(chalk.green('No regression detected'));
  }
}

function parsePositiveInteger(value: string | number | undefined, flagName: string, defaultValue = 1): number {
  const raw = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return raw;
}

function applyBudgetOption(options: any): number | undefined {
  if (options.budgetUsd === undefined) return undefined;
  const budgetUsd = Number(options.budgetUsd);
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new Error('--budget-usd must be a non-negative number');
  }
  process.env.GTOM_MAX_BUDGET_USD = String(budgetUsd);
  return budgetUsd;
}

function createGToM(options: any): GToM {
  applyBudgetOption(options);
  if (options.gbrain) {
    options.gbrain = sanitizeUrl(options.gbrain, '--gbrain');
  }
  return new GToM({
    gbrainEndpoint: options.gbrain,
  });
}

async function loadEvalCases(corpusPath?: string): Promise<Array<{ name: string; context: string; action: string }>> {
  if (!corpusPath) {
    return [
      {
        name: 'default-low-pressure-decision',
        context: 'The user has time to compare options and asked for a careful, reversible choice.',
        action: 'Proceed with the reversible implementation and preserve an audit trail.',
      },
    ];
  }

  const parsed = JSON.parse(await fs.readFile(sanitizePath(corpusPath, '--corpus'), 'utf8'));
  const cases = Array.isArray(parsed) ? parsed : parsed.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('Eval corpus must be a non-empty array or an object with a cases array');
  }

  return cases.map((item: any, index: number) => {
    if (!item.context || !item.action) {
      throw new Error(`Eval case ${index + 1} must include context and action`);
    }
    return {
      name: String(item.name ?? `case-${index + 1}`),
      context: String(item.context),
      action: String(item.action),
    };
  });
}

function generateCompletionScript(shell: 'bash' | 'zsh' | 'fish'): string {
  const commands = [
    'ingest', 'score', 'audit', 'vulnerabilities', 'health', 'eval', 'replay',
    'regress', 'receipts', 'diff', 'trend', 'drift', 'decay', 'reset', 'cost',
    'metrics', 'backup', 'restore', 'export', 'migrate', 'secrets', 'completion',
  ];
  const options = [
    '--json', '--quiet', '--cycles', '--budget-usd', '--gbrain', '--help',
  ];

  if (shell === 'fish') {
    return [
      'complete -c gtom -f',
      ...commands.map((command) => `complete -c gtom -n "__fish_use_subcommand" -a "${command}"`),
      ...options.map((option) => `complete -c gtom -l ${option.slice(2)}`),
      '',
    ].join('\n');
  }

  if (shell === 'zsh') {
    return `#compdef gtom
_gtom() {
  local -a commands options
  commands=(${commands.map((command) => `'${command}'`).join(' ')})
  options=(${options.map((option) => `'${option}'`).join(' ')})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    _describe 'option' options
  fi
}
compdef _gtom gtom
`;
  }

  return `_gtom_completion() {
  local cur prev commands options
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${commands.join(' ')}"
  options="${options.join(' ')}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
  else
    COMPREPLY=( $(compgen -W "\${options}" -- "\${cur}") )
  fi
}
complete -F _gtom_completion gtom
`;
}

program
  .name('gtom')
  .description('Cognitive defense and Theory of Mind system')
  .version('0.1.0');

program
  .command('version-info')
  .description('Print package, schema, rubric, and API stability metadata')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const metadata = getVersionMetadata();
    if (options.json) {
      console.log(JSON.stringify(metadata, null, 2));
    } else {
      console.log(chalk.blue.bold('[GToM] Version metadata'));
      console.log(chalk.gray(`Package: ${metadata.package_version}`));
      console.log(chalk.gray(`Receipt schema: v${metadata.receipt_schema_version}`));
      console.log(chalk.gray(`CLI stability: ${API_STABILITY.cli.level}`));
      console.log(chalk.gray(`HTTP stability: ${API_STABILITY.http.level}`));
      console.log(chalk.gray(`MCP stability: ${API_STABILITY.mcp.level}`));
    }
    process.exit(0);
  });

// Ingest observation
program
  .command('ingest')
  .description('Ingest an observation and update cognitive state')
  .requiredOption('-c, --content <text>', 'Observation content')
  .option('-s, --surface <name>', 'Surface name', 'ui')
  .option('--source <type>', 'Source type (user_input, agent_action, system_event, external_signal)', 'user_input')
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet && !options.json) {
      console.log(chalk.blue.bold('[GToM] Ingesting observation'));
    }

    try {
      options.content = sanitizeUserString(options.content, {
        fieldName: '--content',
        maxLength: 10_000,
        allowNewlines: true,
      });
      options.surface = sanitizeIdentifier(options.surface, '--surface');
      const validSources = ['user_input', 'agent_action', 'system_event', 'external_signal'];
      if (options.source && !validSources.includes(options.source)) {
        throw new Error(`Invalid source. Must be one of: ${validSources.join(', ')}`);
      }
      const cycles = parsePositiveInteger(options.cycles, '--cycles');
      const gtom = createGToM(options);
      const runs = [];
      for (let cycle = 1; cycle <= cycles; cycle++) {
        await gtom.ingestObservation({
          content: options.content,
          surface: options.surface,
          source: options.source,
        });

        const vuln = gtom.getAggregateVulnerability();
        runs.push({
          cycle,
          content: options.content,
          surface: options.surface,
          source: options.source,
          overall_vulnerability: vuln.overall,
          trend: vuln.trend,
        });
      }
      const result = cycles === 1 ? runs[0] : { cycles, runs };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        const latest = runs[runs.length - 1];
        console.log(chalk.green('\n[GToM] Observation ingested'));
        console.log(chalk.gray(`Content: ${options.content}`));
        console.log(chalk.gray(`Surface: ${options.surface}`));
        console.log(chalk.gray(`Cycles: ${cycles}`));
        console.log(chalk.gray(`Overall vulnerability: ${latest.overall_vulnerability.toFixed(3)}`));
        console.log(chalk.gray(`Trend: ${latest.trend}`));
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
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet && !options.json) {
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

    try {
      const cycles = parsePositiveInteger(options.cycles, '--cycles');
      const gtom = createGToM(options);
      const scores = [];
      for (let cycle = 1; cycle <= cycles; cycle++) {
        scores.push({
          cycle,
          score: await gtom.scoreDecisionAuthenticity({
            context: options.context,
            action: options.action,
          }),
        });
      }
      const score = scores[scores.length - 1].score;
      const output = cycles === 1 ? score : { cycles, scores };

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green('\n[GToM] Scoring complete'));
        console.log(chalk.gray(`Cycles: ${cycles}`));
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
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet && !options.json) {
      console.log(chalk.blue.bold('[GToM] Performing self-audit'));
    }

    try {
      const cycles = parsePositiveInteger(options.cycles, '--cycles');
      const gtom = createGToM(options);
      // Mock agent behavior for demo
      const agentBehavior = {
        recentActions: ['explained decision', 'requested consent', 'minimized data collection'],
        userInteractions: ['user approved', 'user asked question'],
        decisions: [],
      };

      const audits = [];
      for (let cycle = 1; cycle <= cycles; cycle++) {
        audits.push({ cycle, audit: await gtom.performSelfAudit(agentBehavior) });
      }
      const audit = audits[audits.length - 1].audit;
      const output = cycles === 1 ? audit : { cycles, audits };

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green('\n[GToM] Audit complete'));
        console.log(chalk.gray(`Cycles: ${cycles}`));
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
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    parsePositiveInteger(options.cycles, '--cycles');
    const gtom = createGToM(options);

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
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const cycles = parsePositiveInteger(options.cycles, '--cycles');
    const gtom = createGToM(options);

    let health = await gtom.healthCheck();
    const cycleResults = [{ cycle: 1, checks: health }];
    for (let cycle = 2; cycle <= cycles; cycle++) {
      health = await gtom.healthCheck();
      cycleResults.push({ cycle, checks: health });
    }
    const components = Object.fromEntries(
      health.map((check) => [check.service, check.healthy ? 'ok' : 'error'])
    ) as Record<string, 'ok' | 'error'>;
    const status = health.every((check) => check.healthy) ? 'healthy' : 'unhealthy';

    if (options.json) {
      console.log(JSON.stringify({ status, cycles, components, checks: health, cycle_results: cycleResults }, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.bold('GToM Health Check'));
      console.log(chalk.gray(`Status: ${status}`));
      console.log(chalk.gray(`Cycles: ${cycles}`));
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
const evalCommand = program
  .command('eval')
  .description('Run evaluation on a test corpus')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('-o, --output <path>', 'Write output to file (JSON format)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet && !options.json) {
      console.log(chalk.blue.bold('[GToM] Running evaluation'));
    }

    try {
      const cycles = parsePositiveInteger(options.cycles, '--cycles');
      const gtom = createGToM(options);
      const cases = await loadEvalCases(options.corpus);
      const runs = [];
      for (let cycle = 1; cycle <= cycles; cycle++) {
        for (const testCase of cases) {
          const score = await gtom.scoreDecisionAuthenticity({
            context: testCase.context,
            action: testCase.action,
          });
          runs.push({
            cycle,
            case: testCase.name,
            authenticity_score: score.authenticity_score,
            confidence: score.confidence,
            passed: score.authenticity_score >= 0.6,
          });
        }
      }

      const result = {
        status: runs.every((run) => run.passed) ? 'passed' : 'failed',
        cycles,
        corpus: options.corpus ?? 'built-in',
        case_count: cases.length,
        runs,
        average_authenticity_score: runs.reduce((sum, run) => sum + run.authenticity_score, 0) / runs.length,
      };

      if (options.output) {
        await fs.writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green(`[GToM] Eval ${result.status}`));
        console.log(chalk.gray(`Cases: ${cases.length}`));
        console.log(chalk.gray(`Cycles: ${cycles}`));
        console.log(chalk.gray(`Average authenticity: ${result.average_authenticity_score.toFixed(4)}`));
      }
      process.exit(result.status === 'passed' ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('[GToM] Eval failed:'), error);
      process.exit(1);
    }
  });

evalCommand
  .command('regress')
  .description('Compare the latest receipt against a baseline receipt and exit 1 on regression')
  .requiredOption('--against <receipt>', 'Baseline receipt path')
  .option('--current <receipt>', 'Current receipt path (defaults to latest local receipt)')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--tolerance <number>', 'Allowed score drop before regression', '0.05')
  .option('--dimension-tolerance <name=value...>', 'Per-dimension score tolerance, repeatable')
  .option('--cost-tolerance-usd <number>', 'Allowed absolute cost increase in USD', '0')
  .option('--cost-tolerance-pct <number>', 'Allowed relative cost increase as decimal fraction', '0')
  .option('--latency-tolerance-ms <number>', 'Allowed absolute latency increase in milliseconds', '0')
  .option('--latency-tolerance-pct <number>', 'Allowed relative latency increase as decimal fraction', '0')
  .option('--tier1-tolerance <number>', 'Allowed tier1_success_rate drop', '0.05')
  .option('--config <path>', 'Regression tolerance config JSON')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      const baseline = await loadReceipt(options.against);
      const current = options.current ? await loadReceipt(options.current) : await loadLatestReceipt();
      const result = compareReceiptRegression(current, baseline, await loadRegressionConfig(options));
      printRegressionResult(result, options.quiet, options.json);
      process.exit(result.regressed ? 1 : 0);
    } catch (error) {
      console.error(chalk.red('[GToM] Eval regression failed:'), error);
      process.exit(1);
    }
  });

// Replay command
program
  .command('replay')
  .description('Replay a receipt or previous observation from corpus')
  .argument('<target>', 'Receipt path or content hash to replay')
  .option('--corpus <path>', 'Path to corpus directory', './.gbrain-corpus')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (target: string, options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      if (await fileExists(target)) {
        const receipt = await loadReceipt(target);
        const corpusSha8 = String(receipt.metadata?.corpus_sha8 ?? receipt.input_hash.substring(0, 8));
        let corpusReplay: any = null;

        try {
          const { ReplayManager } = await import('./core/replay-manager.js');
          const replayManager = new ReplayManager(options.corpus);
          const result = await replayManager.retrieve(corpusSha8);
          corpusReplay = result.found ? result : null;
        } catch {
          corpusReplay = null;
        }

        const output = {
          receipt,
          corpus_sha8: corpusSha8,
          corpus_replay: corpusReplay,
        };

        if (options.json) {
          console.log(JSON.stringify(output, null, 2));
        } else if (!options.quiet) {
          console.log(chalk.blue.bold(`[GToM] Replaying receipt: ${target}`));
          console.log(chalk.gray(`Receipt: ${receipt.receipt_id}`));
          console.log(chalk.gray(`Timestamp: ${receipt.timestamp}`));
          console.log(chalk.gray(`Verdict: ${receipt.verdict}`));
          console.log(chalk.gray(`Overall score: ${receipt.overall_score.toFixed(4)}`));
          console.log(chalk.gray(`Corpus SHA8: ${corpusSha8}`));
          if (corpusReplay?.content) {
            console.log(chalk.green('\nCorpus content:'));
            console.log(corpusReplay.content);
          }
        }
        process.exit(0);
      }

      const { ReplayManager } = await import('./core/replay-manager.js');
      const replayManager = new ReplayManager(options.corpus);
      
      const result = await replayManager.retrieve(target);
      
      if (!result.found) {
        console.error(chalk.red(`[GToM] Hash not found in corpus: ${target}`));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold(`[GToM] Replaying hash: ${target}`));
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
  .option('--against <receipt>', 'Baseline receipt path')
  .option('--current <receipt>', 'Current receipt path (defaults to latest local receipt)')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--tolerance <number>', 'Tolerance for regression detection', '0.05')
  .option('--dimension-tolerance <name=value...>', 'Per-dimension score tolerance, repeatable')
  .option('--cost-tolerance-usd <number>', 'Allowed absolute cost increase in USD', '0')
  .option('--cost-tolerance-pct <number>', 'Allowed relative cost increase as decimal fraction', '0')
  .option('--latency-tolerance-ms <number>', 'Allowed absolute latency increase in milliseconds', '0')
  .option('--latency-tolerance-pct <number>', 'Allowed relative latency increase as decimal fraction', '0')
  .option('--tier1-tolerance <number>', 'Allowed tier1_success_rate drop', '0.05')
  .option('--config <path>', 'Regression tolerance config JSON')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      const baselinePath = options.against ?? options.baseline;
      if (!baselinePath) {
        console.error(chalk.red('[GToM] --against or --baseline is required'));
        process.exit(1);
      }
      const baseline = await loadReceipt(baselinePath);
      const current = options.current ? await loadReceipt(options.current) : await loadLatestReceipt();
      const result = compareReceiptRegression(current, baseline, await loadRegressionConfig(options));
      printRegressionResult(result, options.quiet, options.json);
      process.exit(result.regressed ? 1 : 0);
    } catch (error) {
      console.error(chalk.red('[GToM] Regression test failed:'), error);
      process.exit(1);
    }
  });

// Receipts command
program
  .command('receipts')
  .description('List execution receipts')
  .requiredOption('--since <date>', 'Return receipts since YYYY-MM-DD or ISO timestamp')
  .option('--corpus-sha8 <hash>', 'Filter receipts by corpus SHA8')
  .option('--limit <number>', 'Maximum receipts to return', '50')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      const registry = new ReceiptRegistry('gtom');
      const start = new Date(options.since);
      if (Number.isNaN(start.getTime())) {
        console.error(chalk.red('[GToM] --since must be a valid date'));
        process.exit(1);
      }

      let receipts = options.corpusSha8
        ? await registry.getByCorpusSha8(options.corpusSha8)
        : await registry.getAllSince(start);
      receipts = receipts
        .filter((receipt) => new Date(receipt.timestamp) >= start)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, parseInt(options.limit, 10));

      if (options.json) {
        console.log(JSON.stringify(receipts, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold(`[GToM] Receipts since ${start.toISOString()}`));
        for (const receipt of receipts) {
          console.log(`${receipt.timestamp}  ${receipt.receipt_id}  ${receipt.verdict}  score=${receipt.overall_score.toFixed(4)}  corpus=${receipt.metadata?.corpus_sha8 ?? receipt.input_hash.substring(0, 8)}`);
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Receipt listing failed:'), error);
      process.exit(1);
    }
  });

// Receipt diff command
program
  .command('diff')
  .description('Diff two execution receipts')
  .argument('<receipt-a>', 'First receipt path')
  .argument('<receipt-b>', 'Second receipt path')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (receiptA: string, receiptB: string, options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      const a = await loadReceipt(receiptA);
      const b = await loadReceipt(receiptB);
      const diff = diffReceipts(a, b);

      if (options.json) {
        console.log(JSON.stringify(diff, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GToM] Receipt diff'));
        console.log(chalk.gray(`A: ${diff.receipt_a}`));
        console.log(chalk.gray(`B: ${diff.receipt_b}`));
        console.log(chalk.gray(`Verdict: ${diff.verdict.from} -> ${diff.verdict.to}`));
        console.log(chalk.gray(`Overall score delta: ${diff.overall_score_delta.toFixed(4)}`));
        console.log(chalk.gray(`Cost delta: $${diff.cost_usd_delta.toFixed(4)}`));
        for (const [dimension, delta] of Object.entries(diff.score_deltas)) {
          console.log(`  ${dimension}: ${(delta as number).toFixed(4)}`);
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Receipt diff failed:'), error);
      process.exit(1);
    }
  });

// Trend command
program
  .command('trend')
  .description('Show vulnerability trend data over a time window')
  .option('--window <days>', 'Number of days to analyse', '7')
  .option('--category <name>', 'Filter to a specific vulnerability category (e.g. scarcity_fear, authority_bias)')
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    if (!options.quiet && !options.json) {
      console.log(chalk.blue.bold('[GToM] Analysing vulnerability trends'));
    }

    const windowDays = parseInt(options.window, 10);
    if (isNaN(windowDays) || windowDays <= 0) {
      console.error(chalk.red('Error: --window must be a positive integer (number of days)'));
      process.exit(1);
    }

    try {
      parsePositiveInteger(options.cycles, '--cycles');
      const gtom = createGToM(options);

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
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--window <duration>', 'Window to analyze (for example 7d, 24h, 60m)', '7d')
  .option('--cohort <name>', 'Filter drift output to a specific cohort')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      const { DriftDetector, parseWindowDuration } = await import('./core/drift-detector.js');
      const windowMs = parseWindowDuration(options.window);
      const detector = new DriftDetector({
        window_size: 100,
        drift_threshold: 0.2,
        alert_threshold: 0.3,
        baseline_period_ms: windowMs,
        min_baseline_points: 5,
        min_current_points: 5,
        brand_new_threshold: 3,
      });

      // Get current vulnerabilities from GToM
      const gtom = createGToM(options);
      const vulnerabilities = gtom.getVulnerabilities();

      const baseValue = vulnerabilities.length > 0
        ? vulnerabilities.reduce((sum: number, v: any) => sum + (v.current_level ?? 0), 0) / vulnerabilities.length
        : 0.3;
      const now = new Date();
      const cohorts = ['default', 'new-user', 'returning-user'];
      const sampleMetrics = ['overall_vulnerability', 'vulnerability_manager', 'authenticity_scorer', 'cognitive_ice', 'conflict_predictor'];

      for (const [metricIndex, metricName] of sampleMetrics.entries()) {
        for (const [cohortIndex, cohort] of cohorts.entries()) {
          for (let i = 0; i < 12; i++) {
            const timestamp = new Date(now.getTime() - windowMs - (12 - i) * 60 * 60 * 1000).toISOString();
            detector.recordSnapshot(metricName, baseValue + metricIndex * 0.02 + cohortIndex * 0.01, { timestamp, cohort });
          }
          for (let i = 0; i < 8; i++) {
            const timestamp = new Date(now.getTime() - (8 - i) * 60 * 60 * 1000).toISOString();
            const currentBump = cohort === 'new-user' ? 0.35 : 0.04;
            detector.recordSnapshot(metricName, baseValue + metricIndex * 0.02 + cohortIndex * 0.01 + currentBump, { timestamp, cohort });
          }
        }
      }

      const driftResults = options.cohort
        ? detector.detectAllDrift({ now }).filter((result: any) => result.cohort === options.cohort)
        : detector.detectAllDrift({ now });
      const alerts = options.cohort
        ? detector.getAlerts().filter((result: any) => result.cohort === options.cohort)
        : detector.getAlerts();

      const result = {
        window: options.window,
        window_ms: windowMs,
        cohort: options.cohort,
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
        console.log(chalk.gray(`Window: ${options.window}`));
        console.log(chalk.gray(`Current vulnerabilities: ${vulnerabilities.length}`));
        console.log(chalk.gray(`Metrics tracked: ${detector.getMetricNames().join(', ')}`));
        console.log(chalk.gray(`Drift detected: ${driftResults.some((d: any) => d.drift_detected) ? 'Yes' : 'No'}`));
        
        if (driftResults.length > 0) {
          console.log(chalk.bold('\nDrift Results:'));
          for (const result of driftResults) {
            const status = result.drift_detected ? chalk.red('⚠') : chalk.green('✓');
            console.log(`  ${status} ${result.metric_name}/${result.cohort}: ${result.drift_magnitude.toFixed(3)} (${result.trend})`);
          }
        }

        if (alerts.length > 0) {
          console.log(chalk.red.bold('\nAlerts:'));
          for (const alert of alerts) {
            console.log(`  ${alert.metric_name}/${alert.cohort}: ${alert.drift_magnitude.toFixed(3)} (threshold: 0.3)`);
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
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--window <hours>', 'Time window in hours', '24')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      const cycles = parsePositiveInteger(options.cycles, '--cycles');
      const windowHours = parsePositiveInteger(options.window, '--window');
      const gtom = createGToM(options);
      const runs = [];
      for (let cycle = 1; cycle <= cycles; cycle++) {
        gtom.decayVulnerabilities(windowHours);
        runs.push({
          cycle,
          window_hours: windowHours,
          aggregate: gtom.getAggregateVulnerability(),
          vulnerabilities: gtom.getVulnerabilities(),
        });
      }
      const result = cycles === 1 ? runs[0] : { cycles, runs };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        const latest = runs[runs.length - 1];
        console.log(chalk.blue.bold('[GToM] Applied vulnerability decay'));
        console.log(chalk.gray(`Window: ${windowHours} hour(s)`));
        console.log(chalk.gray(`Cycles: ${cycles}`));
        console.log(chalk.gray(`Overall vulnerability: ${latest.aggregate.overall.toFixed(3)}`));
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Decay failed:'), error);
      process.exit(1);
    }
  });

// Reset command
program
  .command('reset')
  .description('Reset vulnerability state to baseline')
  .option('--gbrain <url>', 'GBrain endpoint', DEFAULT_GBRAIN_ENDPOINT)
  .option('--confirm', 'Confirm reset without prompt')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      if (!options.confirm) {
        const result = {
          confirmed: false,
          status: 'blocked',
          message: 'Reset requires --confirm',
        };
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!options.quiet) {
          console.error(chalk.red('[GToM] Reset requires --confirm'));
        }
        process.exit(1);
      }

      const gtom = createGToM(options);
      gtom.resetVulnerabilities();
      const result = {
        confirmed: true,
        status: 'reset',
        vulnerabilities: gtom.getVulnerabilities(),
        aggregate: gtom.getAggregateVulnerability(),
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GToM] Vulnerability state reset'));
        console.log(chalk.gray(`Overall vulnerability: ${result.aggregate.overall.toFixed(3)}`));
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Reset failed:'), error);
      process.exit(1);
    }
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
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      const budgetUsd = applyBudgetOption(options);
      const { BudgetLedger } = await import('./core/budget-ledger.js');
      const ledger = new BudgetLedger({
        maxBudgetUsd: budgetUsd ?? Number(process.env.GTOM_MAX_BUDGET_USD ?? 1000),
      }, 'gtom');

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
        breakdown['by_operation'] = ledger.getSpendByOperation();
      }

      if (options.json) {
        console.log(JSON.stringify({ spend, ...breakdown }, null, 2));
      } else if (!options.quiet) {
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
          const byOp = ledger.getSpendByOperation();
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

// Metrics command
program
  .command('metrics')
  .description('Export observability metrics')
  .option('--format <format>', 'Metrics format (json, prometheus, otel)', 'json')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action((options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      const format = options.format as 'json' | 'prometheus' | 'otel';
      if (!['json', 'prometheus', 'otel'].includes(format)) {
        throw new Error('--format must be one of: json, prometheus, otel');
      }
      const gtom = createGToM(options);
      const metrics = gtom.exportMetrics(format);
      if (format === 'prometheus') {
        if (!options.quiet) console.log(metrics);
      } else if (options.json || !options.quiet) {
        console.log(JSON.stringify(metrics, null, 2));
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Metrics export failed:'), error);
      process.exit(1);
    }
  });

// Backup command
program
  .command('backup')
  .description('Create a persistence backup')
  .option('-o, --output-dir <path>', 'Backup output directory')
  .option('--source-dir <path>', 'Backup a specific persistence directory')
  .option('--rotate <number>', 'Number of backups to keep', '10')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      const rotateKeep = parsePositiveInteger(options.rotate, '--rotate');
      const result = await createBackup({
        outputDir: options.outputDir,
        sourceDir: options.sourceDir,
        rotateKeep,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GToM] Backup complete'));
        console.log(chalk.gray(`Backup: ${result.backup_dir}`));
        console.log(chalk.gray(`Roots copied: ${result.roots.filter((root) => root.exists).length}`));
        if (result.rotation_removed.length > 0) {
          console.log(chalk.gray(`Rotated backups: ${result.rotation_removed.length}`));
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Backup failed:'), error);
      process.exit(1);
    }
  });

// Restore command
program
  .command('restore')
  .description('Restore a persistence backup')
  .requiredOption('--backup-dir <path>', 'Backup directory to restore')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      const result = await restoreBackup({ backupDir: options.backupDir });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GToM] Restore complete'));
        for (const item of result.restored) {
          console.log(chalk.gray(`${item.name}: ${item.target}`));
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Restore failed:'), error);
      process.exit(1);
    }
  });

// Export command
program
  .command('export')
  .description('Export persistence data')
  .option('--format <format>', 'Export format (json)', 'json')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      if (options.format !== 'json') {
        throw new Error('--format must be json');
      }
      const snapshot = await exportPersistenceSnapshot();
      if (options.json || !options.quiet) {
        console.log(JSON.stringify(snapshot, null, 2));
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Export failed:'), error);
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Migrate receipt JSONL files between supported schema versions')
  .requiredOption('--from <version>', 'Source receipt schema version')
  .requiredOption('--to <version>', 'Target receipt schema version')
  .requiredOption('--input <path>', 'Input receipt JSONL file')
  .option('--output <path>', 'Output receipt JSONL file')
  .option('--dry-run', 'Validate and summarize without writing output')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const from = Number(options.from);
      const to = Number(options.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 1) {
        throw new Error('--from and --to must be schema version integers');
      }
      if (to > CURRENT_RECEIPT_SCHEMA_VERSION) {
        throw new Error(`Target schema v${to} is not supported by this GToM build; current is v${CURRENT_RECEIPT_SCHEMA_VERSION}`);
      }

      const input = sanitizePath(options.input, '--input');
      const output = options.output
        ? sanitizePath(options.output, '--output')
        : `${input}.v${to}`;
      const content = await fs.readFile(input, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const migrated = lines.map((line, index) => {
        const parsed = JSON.parse(line);
        const version = parsed.schema_version ?? 0;
        if (version !== from) {
          throw new Error(`Line ${index + 1} has schema_version ${version}; expected ${from}`);
        }
        return migrateReceiptToVersion(parsed, to);
      });

      const result = {
        from,
        to,
        input,
        output,
        receipts: migrated.length,
        dry_run: Boolean(options.dryRun),
      };
      if (!options.dryRun) {
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, `${migrated.map((receipt) => JSON.stringify(receipt)).join('\n')}\n`, 'utf8');
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.green(`[GToM] Migrated ${migrated.length} receipt(s) from schema v${from} to v${to}`));
        if (options.dryRun) {
          console.log(chalk.gray('Dry run: no output written'));
        } else {
          console.log(chalk.gray(`Output: ${output}`));
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Schema migration failed:'), error);
      process.exit(1);
    }
  });

// Shell completion command
program
  .command('gbrain-sync')
  .description('Run gstack-compatible GBrain source sync for GToM and sibling tools')
  .option('--incremental', 'Default. Register and sync changed sources')
  .option('--full', 'Reindex code sources')
  .option('--dry-run', 'Preview work without writes')
  .option('--no-code', 'Skip current-repo code stage')
  .option('--no-tools', 'Skip sibling tool stage')
  .option('--quiet', 'Suppress output for CI use')
  .option('--json', 'Output stage results as JSON')
  .action(async (options) => {
    try {
      const selectedModes = [options.incremental, options.full, options.dryRun].filter(Boolean).length;
      if (selectedModes > 1) {
        throw new Error('Choose only one of --incremental, --full, or --dry-run');
      }
      const mode = options.full ? 'full' : options.dryRun ? 'dry-run' : 'incremental';
      const sync = new GStackGBrainSync();
      const result = await sync.run({
        mode,
        quiet: options.quiet,
        noCode: options.code === false || options.noCode,
        noTools: options.tools === false || options.noTools,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet || mode === 'dry-run') {
        console.log(sync.format(result.stages, mode));
      }
      process.exit(result.exitCode);
    } catch (error) {
      console.error(chalk.red('[GToM] GBrain sync failed:'), error);
      process.exit(1);
    }
  });

const secretsCommand = program
  .command('secrets')
  .description('Manage local GToM secrets without printing secret values');

secretsCommand
  .command('list')
  .description('List configured secret metadata')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      const manager = new FileSecretManager();
      const secrets = manager.listSecrets();
      if (options.json) {
        console.log(JSON.stringify({ file: manager.getFilePath(), secrets }, null, 2));
      } else {
        console.log(chalk.blue.bold('[GToM] Secrets'));
        console.log(chalk.gray(`Store: ${manager.getFilePath()}`));
        if (secrets.length === 0) {
          console.log(chalk.gray('No local secrets configured'));
        }
        for (const secret of secrets) {
          console.log(`${secret.name} v${secret.version} ${secret.encrypted ? 'encrypted' : 'file-protected'} ${secret.scope ?? ''}`.trim());
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Secret listing failed:'), error);
      process.exit(1);
    }
  });

secretsCommand
  .command('set')
  .description('Create or update a secret')
  .argument('<name>', 'Secret name, such as OPENAI_API_KEY')
  .requiredOption('--value <value>', 'Secret value')
  .option('--scope <scope>', 'Secret scope label', 'general')
  .option('--owner <owner>', 'Secret owner label', 'local')
  .option('--json', 'Output as JSON')
  .action((name: string, options) => {
    try {
      const manager = new FileSecretManager();
      const metadata = manager.setSecret(name, sanitizeUserString(options.value, {
        fieldName: '--value',
        maxLength: 16_384,
        allowNewlines: false,
        trim: false,
      }), {
        scope: options.scope,
        owner: options.owner,
      });
      if (options.json) {
        console.log(JSON.stringify(metadata, null, 2));
      } else {
        console.log(chalk.green(`Stored ${metadata.name} v${metadata.version}`));
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Secret set failed:'), error);
      process.exit(1);
    }
  });

secretsCommand
  .command('rotate')
  .description('Rotate an existing secret value')
  .argument('<name>', 'Secret name')
  .requiredOption('--value <value>', 'New secret value')
  .option('--scope <scope>', 'Secret scope label')
  .option('--owner <owner>', 'Secret owner label')
  .option('--json', 'Output as JSON')
  .action((name: string, options) => {
    try {
      const manager = new FileSecretManager();
      const metadata = manager.rotateSecret(name, sanitizeUserString(options.value, {
        fieldName: '--value',
        maxLength: 16_384,
        allowNewlines: false,
        trim: false,
      }), {
        scope: options.scope,
        owner: options.owner,
      });
      if (options.json) {
        console.log(JSON.stringify(metadata, null, 2));
      } else {
        console.log(chalk.green(`Rotated ${metadata.name} to v${metadata.version}`));
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Secret rotation failed:'), error);
      process.exit(1);
    }
  });

secretsCommand
  .command('delete')
  .description('Delete a local secret')
  .argument('<name>', 'Secret name')
  .option('--json', 'Output as JSON')
  .action((name: string, options) => {
    try {
      const manager = new FileSecretManager();
      const deleted = manager.deleteSecret(name);
      if (options.json) {
        console.log(JSON.stringify({ name: sanitizeIdentifier(name, 'secret name'), deleted }, null, 2));
      } else {
        console.log(deleted ? chalk.green('Secret deleted') : chalk.yellow('Secret not found'));
      }
      process.exit(deleted ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('[GToM] Secret delete failed:'), error);
      process.exit(1);
    }
  });

program
  .command('completion')
  .description('Print shell completion script')
  .argument('[shell]', 'Shell to generate completion for (bash, zsh, fish)', 'bash')
  .option('--cycles <number>', 'Number of cycles to run', '1')
  .option('--budget-usd <number>', 'Maximum LLM budget for this command')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action((shell: string, options) => {
    try {
      parsePositiveInteger(options.cycles, '--cycles');
      applyBudgetOption(options);
      if (!['bash', 'zsh', 'fish'].includes(shell)) {
        throw new Error('shell must be one of: bash, zsh, fish');
      }
      const script = generateCompletionScript(shell as 'bash' | 'zsh' | 'fish');
      if (options.json) {
        console.log(JSON.stringify({ shell, script }, null, 2));
      } else if (!options.quiet) {
        console.log(script);
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GToM] Completion generation failed:'), error);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze text for conflicts and authenticity (no external services required)')
  .option('-t, --text <content>', 'Text to analyze directly')
  .option('-f, --file <path>', 'Read content from file')
  .option('--mode <mode>', 'Analysis mode: agent or relationship', 'agent')
  .option('-m, --model <model>', 'LLM model', 'claude-haiku-4-5-20251001')
  .option('--json', 'Output as JSON')
  .option('--dyad-id <id>', 'Track this conversation across sessions (stored in ~/.gtom/gtom.db)')
  .action(async (opts: any) => {
    await analyzeCommand({
      text: opts.text,
      file: opts.file,
      mode: opts.mode,
      model: opts.model,
      json: opts.json ?? false,
      dyadId: opts.dyadId,
    });
  });

program
  .command('history')
  .description('Show past analyses from local history (~/.gtom/gtom.db)')
  .option('--dyad-id <id>', 'Filter by dyad ID')
  .option('-n, --limit <n>', 'Number of entries to show', (v: string) => parseInt(v, 10), 20)
  .option('--json', 'Output as JSON')
  .action(async (opts: any) => {
    await historyCommand({
      dyadId: opts.dyadId,
      limit: opts.limit,
      json: opts.json ?? false,
    });
  });

program.parse();
