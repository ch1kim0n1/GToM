import chalk from 'chalk';
import { getAnalyses } from '../db';

export interface HistoryOptions {
  dyadId?: string;
  limit: number;
  json: boolean;
}

export async function historyCommand(options: HistoryOptions): Promise<void> {
  const rows = getAnalyses(options.dyadId, options.limit);

  if (options.json) {
    console.log(JSON.stringify(rows.map(r => ({ ...r, result: JSON.parse(r.result) })), null, 2));
    return;
  }

  if (rows.length === 0) {
    const filter = options.dyadId ? ` for dyad '${options.dyadId}'` : '';
    console.log(chalk.gray(`No analyses found${filter}. Run: gtom analyze --text "<conversation>"`));
    return;
  }

  const filter = options.dyadId ? chalk.cyan(` [dyad: ${options.dyadId}]`) : '';
  console.log(chalk.blue(`GToM Analysis History${filter} (${rows.length} entries)`));
  console.log('');

  for (const row of rows) {
    const result = JSON.parse(row.result);
    const ts = new Date(row.created_at).toLocaleString();
    const authScore = result.authenticity_score ?? 0;
    const authColor = authScore >= 0.7 ? chalk.green : authScore >= 0.5 ? chalk.yellow : chalk.red;
    const conflictCount = result.conflicts?.length ?? 0;
    const snippet = row.snippet ? chalk.gray(` — "${row.snippet.slice(0, 50)}..."`) : '';

    console.log(`  ${chalk.bold(`[${row.dyad_id}]`)} ${chalk.gray(row.mode)} | auth: ${authColor((authScore * 100).toFixed(0) + '%')} | conflicts: ${conflictCount}${snippet}`);
    console.log(`  ${chalk.gray(ts)}`);
    console.log('');
  }
}
