import * as fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import { saveAnalysis } from '../db';

export interface AnalyzeOptions {
  text?: string;
  file?: string;
  mode: 'agent' | 'relationship';
  model: string;
  json: boolean;
  dyadId?: string;
}

interface Conflict {
  type: string;
  severity: number;
  description: string;
  parties?: string[];
}

interface AgentResult {
  conflicts: Conflict[];
  authenticity_score: number;
  tension_points: string[];
  dominant_pattern: string;
  recommendations: string[];
}

interface RelationshipResult {
  conflicts: Conflict[];
  authenticity_score: number;
  bid_acceptance_rate: number;
  four_horsemen_detected: string[];
  repair_attempts: Array<{ attempt: string; outcome: string }>;
  dominant_pattern: string;
  sentiment_ratio: number;
  recommendations: string[];
}

const AGENT_PROMPT = `You are a conflict prediction system analyzing agent decision logs or multi-party interactions.
Identify: cognitive conflicts (agents pulling in different directions), authenticity gaps (stated vs actual behavior), tension points.

Return ONLY valid JSON (no markdown wrapper):
{
  "conflicts": [{"type":"goal_conflict|resource_conflict|value_conflict","severity":0.7,"description":"brief","parties":["A","B"]}],
  "authenticity_score": 0.8,
  "tension_points": ["description of tension"],
  "dominant_pattern": "collaborative|competitive|avoidant|escalating",
  "recommendations": ["specific action 1", "specific action 2"]
}`;

const RELATIONSHIP_PROMPT = `You are a relationship dynamics analyst using Gottman Method principles.
Analyze for: bids for connection and responses, repair attempts, Four Horsemen (criticism/contempt/defensiveness/stonewalling), sentiment ratio.

Return ONLY valid JSON (no markdown wrapper):
{
  "conflicts": [{"type":"bid_ignored|repair_refused|criticism_pattern|contempt_signal|stonewalling","severity":0.7,"description":"brief","parties":["speaker"]}],
  "authenticity_score": 0.8,
  "bid_acceptance_rate": 0.6,
  "four_horsemen_detected": ["criticism","contempt"],
  "repair_attempts": [{"attempt":"I'm sorry","outcome":"accepted|rejected|ignored"}],
  "dominant_pattern": "secure|anxious|avoidant|disorganized",
  "sentiment_ratio": 0.4,
  "recommendations": ["specific action 1", "specific action 2"]
}

If a field has no data (e.g., no repair attempts), use an empty array.`;

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('Error: ANTHROPIC_API_KEY not set'));
    process.exit(1);
  }

  let content = options.text;
  if (!content && options.file) {
    content = fs.readFileSync(options.file, 'utf-8');
  }
  if (!content) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    content = Buffer.concat(chunks).toString('utf-8');
  }
  if (!content?.trim()) {
    console.error(chalk.red('No content to analyze. Use --text "<content>", --file <path>, or pipe via stdin.'));
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = options.mode === 'relationship' ? RELATIONSHIP_PROMPT : AGENT_PROMPT;

  const response = await client.messages.create({
    model: options.model,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `${systemPrompt}\n\nContent to analyze:\n---\n${content.slice(0, 8000)}\n---`,
    }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(chalk.red('Error: model did not return valid JSON'));
    if (!options.json) console.error('Raw:', raw.slice(0, 500));
    process.exit(1);
  }

  const result = JSON.parse(jsonMatch[0]) as AgentResult | RelationshipResult;

  // Persist result to local SQLite
  saveAnalysis(options.dyadId ?? 'default', options.mode, result, content.slice(0, 200));

  if (options.json) {
    console.log(JSON.stringify({ ...result, mode: options.mode, model: options.model }, null, 2));
    return;
  }

  const modeLabel = options.mode === 'relationship' ? 'Relationship' : 'Agent';
  console.log('');
  console.log(chalk.blue(`GToM Analysis — ${modeLabel} Mode`));
  console.log(chalk.gray(`Model: ${options.model}`));
  console.log('');

  const authScore = result.authenticity_score ?? 0;
  const authColor = authScore >= 0.7 ? chalk.green : authScore >= 0.5 ? chalk.yellow : chalk.red;
  console.log(`Authenticity score: ${authColor((authScore * 100).toFixed(0) + '%')}`);
  console.log(`Dominant pattern:   ${chalk.cyan(result.dominant_pattern ?? 'unknown')}`);

  if (options.mode === 'relationship') {
    const rel = result as RelationshipResult;
    if (typeof rel.bid_acceptance_rate === 'number') {
      const bidColor = rel.bid_acceptance_rate >= 0.6 ? chalk.green : chalk.red;
      console.log(`Bid acceptance:     ${bidColor((rel.bid_acceptance_rate * 100).toFixed(0) + '%')}`);
    }
    if (rel.four_horsemen_detected?.length > 0) {
      console.log(`Four Horsemen:      ${chalk.red(rel.four_horsemen_detected.join(', '))}`);
    }
    if (typeof rel.sentiment_ratio === 'number') {
      const sentColor = rel.sentiment_ratio >= 0.5 ? chalk.green : chalk.red;
      console.log(`Sentiment ratio:    ${sentColor((rel.sentiment_ratio * 100).toFixed(0) + '%')} positive`);
    }
  }

  const conflicts = result.conflicts ?? [];
  if (conflicts.length > 0) {
    console.log('');
    console.log(chalk.yellow(`Conflicts detected (${conflicts.length}):`));
    for (const c of conflicts) {
      const sevColor = c.severity >= 0.7 ? chalk.red : c.severity >= 0.4 ? chalk.yellow : chalk.gray;
      const parties = c.parties?.length ? chalk.gray(` [${c.parties.join(', ')}]`) : '';
      console.log(`  ${sevColor('●')} [${c.type}] ${c.description} — severity: ${(c.severity * 100).toFixed(0)}%${parties}`);
    }
  } else {
    console.log('');
    console.log(chalk.green('No significant conflicts detected.'));
  }

  const recs = result.recommendations ?? [];
  if (recs.length > 0) {
    console.log('');
    console.log(chalk.green('Recommendations:'));
    for (const r of recs) console.log(`  → ${r}`);
  }

  if (options.mode === 'relationship') {
    const rel = result as RelationshipResult;
    if (rel.repair_attempts?.length > 0) {
      console.log('');
      console.log(chalk.blue('Repair attempts:'));
      for (const ra of rel.repair_attempts) {
        const outcomeColor = ra.outcome === 'accepted' ? chalk.green : chalk.red;
        console.log(`  "${ra.attempt}" → ${outcomeColor(ra.outcome)}`);
      }
    }
  }
  console.log('');
}
