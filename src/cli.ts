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
  .action(async (options) => {
    console.log(chalk.blue.bold('[GToM] Ingesting observation'));
    console.log(chalk.gray(`Content: ${options.content}`));
    console.log(chalk.gray(`Surface: ${options.surface}`));

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
      console.log(chalk.green('\n[GToM] Observation ingested'));
      console.log(chalk.gray(`Overall vulnerability: ${vuln.overall.toFixed(3)}`));
      console.log(chalk.gray(`Trend: ${vuln.trend}`));

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
  .action(async (options) => {
    console.log(chalk.blue.bold('[GToM] Scoring decision authenticity'));

    const gtom = new GToM({
      gbrainEndpoint: options.gbrain,
    });

    try {
      const score = gtom.scoreDecisionAuthenticity({
        context: options.context,
        action: options.action,
      });

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
  .action(async (options) => {
    console.log(chalk.blue.bold('[GToM] Performing self-audit'));

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
  .action(async (options) => {
    const gtom = new GToM({
      gbrainEndpoint: options.gbrain,
    });

    const vulns = gtom.getVulnerabilities();
    const aggregate = gtom.getAggregateVulnerability();

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

    process.exit(0);
  });

// Health check
program
  .command('health')
  .description('Check health of GToM and dependencies')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .action(async (options) => {
    const gtom = new GToM({
      gbrainEndpoint: options.gbrain,
    });

    const health = await gtom.healthCheck();

    console.log(chalk.bold('GToM Health Check'));
    console.log(chalk.gray(`Status: ${health.status}`));
    console.log('');
    console.log('Components:');
    console.log(`  Vulnerability Manager: ${health.components.vulnerability_manager === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  Authenticity Scorer: ${health.components.authenticity_scorer === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  Cognitive ICE: ${health.components.cognitive_ice === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  Conflict Predictor: ${health.components.conflict_predictor === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  GBrain: ${health.components.gbrain === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);

    process.exit(health.status === 'healthy' ? 0 : 1);
  });

program.parse();
