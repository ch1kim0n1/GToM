import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';

export type GStackGBrainSyncMode = 'incremental' | 'full' | 'dry-run';

export interface GStackGBrainSyncArgs {
  mode: GStackGBrainSyncMode;
  quiet?: boolean;
  noCode?: boolean;
  noTools?: boolean;
}

export interface GStackGBrainStageResult {
  name: string;
  ran: boolean;
  ok: boolean;
  duration_ms: number;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface GStackGBrainSyncState {
  schema_version: 1;
  last_writer: 'gstack-gbrain-sync';
  last_sync?: string;
  last_full_sync?: string;
  last_stages?: GStackGBrainStageResult[];
}

interface SourceRecord {
  id?: string;
  local_path?: string;
  path?: string;
  page_count?: number;
}

export interface ToolRoot {
  name: string;
  root: string;
}

export type SpawnRunner = (
  command: string,
  args?: readonly string[],
  options?: SpawnSyncOptions,
) => SpawnSyncReturns<string | Buffer>;

export interface GStackGBrainSyncConfig {
  cwd?: string;
  homeDir?: string;
  stateDir?: string;
  gbrainBin?: string;
  toolRoots?: ToolRoot[];
  now?: () => Date;
  spawn?: SpawnRunner;
}

const STALE_LOCK_MS = 5 * 60 * 1000;

export class GStackGBrainSync {
  private readonly cwd: string;
  private readonly stateDir: string;
  private readonly gbrainBin: string;
  private readonly now: () => Date;
  private readonly spawn: SpawnRunner;

  constructor(private readonly config: GStackGBrainSyncConfig = {}) {
    this.cwd = config.cwd ?? process.cwd();
    this.stateDir = config.stateDir ?? process.env.GTOM_HOME ?? path.join(config.homeDir ?? os.homedir(), '.gtom');
    this.gbrainBin = config.gbrainBin ?? 'gbrain';
    this.now = config.now ?? (() => new Date());
    this.spawn = config.spawn ?? spawnSync;
  }

  get statePath(): string {
    return path.join(this.stateDir, 'gstack-gbrain-sync-state.json');
  }

  get lockPath(): string {
    return path.join(this.stateDir, '.gstack-gbrain-sync.lock');
  }

  async run(args: GStackGBrainSyncArgs): Promise<{ stages: GStackGBrainStageResult[]; exitCode: number }> {
    const mode = args.mode;
    let lockHeld = false;
    if (mode !== 'dry-run') {
      lockHeld = this.acquireLock();
      if (!lockHeld) {
        return {
          stages: [{
            name: 'lock',
            ran: false,
            ok: false,
            duration_ms: 0,
            summary: `another gstack-gbrain-sync is running (${this.lockPath})`,
          }],
          exitCode: 2,
        };
      }
    }

    try {
      const stages: GStackGBrainStageResult[] = [];
      if (!args.noCode) {
        stages.push(this.runCodeStage(args));
      }
      if (!args.noTools) {
        stages.push(this.runToolsStage(args));
      }

      if (mode !== 'dry-run') {
        const state = this.loadState();
        state.last_sync = this.now().toISOString();
        if (mode === 'full') {
          state.last_full_sync = state.last_sync;
        }
        state.last_stages = stages;
        this.saveState(state);
      }

      const exitCode = stages.some((stage) => stage.ran && !stage.ok) ? 1 : 0;
      return { stages, exitCode };
    } finally {
      if (lockHeld) {
        this.releaseLock();
      }
    }
  }

  format(stages: GStackGBrainStageResult[], mode: GStackGBrainSyncMode): string {
    const lines = [`gstack-gbrain-sync (${mode}):`];
    for (const stage of stages) {
      const status = !stage.ran ? 'SKIP' : stage.ok ? 'OK' : 'ERR';
      const duration = stage.duration_ms > 0 ? ` (${(stage.duration_ms / 1000).toFixed(1)}s)` : '';
      lines.push(`  ${status.padEnd(5)} ${stage.name.padEnd(12)} ${stage.summary}${duration}`);
    }
    const okCount = stages.filter((stage) => stage.ok).length;
    const errCount = stages.filter((stage) => !stage.ok && stage.ran).length;
    lines.push(``);
    lines.push(`  ${okCount} ok, ${errCount} error, ${stages.length - okCount - errCount} skipped`);
    return lines.join('\n');
  }

  deriveSourceId(prefix: string, repoPath: string, label?: string): string {
    const pathHash8 = crypto.createHash('sha1').update(path.resolve(repoPath)).digest('hex').slice(0, 8);
    const slug = `${label ?? path.basename(repoPath)}-${pathHash8}`;
    return constrainSourceId(prefix, slug);
  }

  deriveLegacySourceId(prefix: string, repoPath: string, label?: string): string {
    return constrainSourceId(prefix, label ?? path.basename(repoPath));
  }

  private runCodeStage(args: GStackGBrainSyncArgs): GStackGBrainStageResult {
    const started = Date.now();
    const root = findGitRoot(this.cwd, this.spawn);
    if (!root) {
      return skip('code', 'skipped (not in git repo)', started);
    }
    const sourceId = this.deriveSourceId('gstack-code', root);
    if (args.mode === 'dry-run') {
      return skip(
        'code',
        `would: gbrain sources add ${sourceId} --path ${root} --federated; gbrain sources attach ${sourceId}; gbrain sync --strategy code --source ${sourceId}`,
        started,
        { source_id: sourceId, source_path: root, status: 'skipped' },
      );
    }

    if (!this.gbrainAvailable()) {
      return failSkip('code', 'skipped (gbrain CLI not in PATH)', started);
    }

    const legacyId = this.deriveLegacySourceId('gstack-code', root);
    const legacyRemoved = legacyId !== sourceId ? this.removeLegacySource(legacyId) : false;
    const registered = this.ensureSource(sourceId, root, true);
    if (!registered.ok) {
      return fail('code', `source registration failed: ${registered.error}`, started, {
        source_id: sourceId,
        source_path: root,
        status: 'failed',
      });
    }

    const attach = this.attachSource(sourceId, root);
    if (!attach.ok) {
      return fail('code', `source attach failed: ${attach.error}`, started, {
        source_id: sourceId,
        source_path: root,
        status: 'failed',
      });
    }

    const syncArgs = args.mode === 'full'
      ? ['reindex-code', '--source', sourceId, '--yes']
      : ['sync', '--strategy', 'code', '--source', sourceId];
    const sync = this.spawn(this.gbrainBin, syncArgs, {
      encoding: 'utf8',
      timeout: 35 * 60 * 1000,
      stdio: args.quiet ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'inherit', 'pipe'],
    });
    if (sync.status !== 0) {
      return fail('code', `gbrain ${syncArgs.join(' ')} exited ${sync.status}`, started, {
        source_id: sourceId,
        source_path: root,
        status: 'failed',
      });
    }

    const pageCount = this.sourcePageCount(sourceId);
    const legacyNote = legacyRemoved ? `, removed legacy ${legacyId}` : '';
    return ok('code', `synced ${sourceId} (page_count=${pageCount ?? 'unknown'}${legacyNote})`, started, {
      source_id: sourceId,
      source_path: root,
      pathhash8: sourceId.slice(-8),
      page_count: pageCount,
      status: 'ok',
    });
  }

  private runToolsStage(args: GStackGBrainSyncArgs): GStackGBrainStageResult {
    const started = Date.now();
    const tools = this.config.toolRoots ?? defaultToolRoots(this.cwd);
    if (args.mode === 'dry-run') {
      const previews = tools.map((tool) => {
        const sourceId = this.deriveSourceId('gstack-tools', tool.root, tool.name);
        return `${tool.name}:${sourceId}`;
      });
      return skip(
        'tools',
        `would: register ${tools.length} tools as federated gbrain sources (${previews.join(', ')})`,
        started,
        { tools: previews },
      );
    }

    if (!this.gbrainAvailable()) {
      return failSkip('tools', 'skipped (gbrain CLI not in PATH)', started);
    }

    const results: Array<{ name: string; source_id: string; status: string; path: string }> = [];
    const errors: string[] = [];

    for (const tool of tools) {
      if (!fs.existsSync(tool.root)) {
        errors.push(`${tool.name}: path not found`);
        results.push({ name: tool.name, source_id: '', status: 'missing', path: tool.root });
        continue;
      }

      const sourceId = this.deriveSourceId('gstack-tools', tool.root, tool.name);
      const legacyId = this.deriveLegacySourceId('gstack-tools', tool.root, tool.name);
      if (legacyId !== sourceId) {
        this.removeLegacySource(legacyId);
      }

      const registered = this.ensureSource(sourceId, tool.root, true);
      if (!registered.ok) {
        errors.push(`${tool.name}: ${registered.error}`);
        results.push({ name: tool.name, source_id: sourceId, status: 'failed', path: tool.root });
        continue;
      }

      const attach = this.attachSource(sourceId, tool.root);
      if (!attach.ok) {
        errors.push(`${tool.name}: attach failed`);
        results.push({ name: tool.name, source_id: sourceId, status: 'failed', path: tool.root });
        continue;
      }

      const syncArgs = args.mode === 'full'
        ? ['reindex-code', '--source', sourceId, '--yes']
        : ['sync', '--strategy', 'code', '--source', sourceId];
      const sync = this.spawn(this.gbrainBin, syncArgs, {
        encoding: 'utf8',
        timeout: 35 * 60 * 1000,
        stdio: args.quiet ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'inherit', 'pipe'],
      });
      if (sync.status !== 0) {
        errors.push(`${tool.name}: sync exited ${sync.status}`);
        results.push({ name: tool.name, source_id: sourceId, status: 'failed', path: tool.root });
        continue;
      }

      results.push({ name: tool.name, source_id: sourceId, status: 'ok', path: tool.root });
    }

    if (errors.length > 0) {
      return fail('tools', `partial: ${errors.length} errors (${errors.join(', ')})`, started, {
        tools: results,
      });
    }
    return ok('tools', `registered and synced ${results.length} federated tool sources`, started, {
      tools: results,
    });
  }

  private gbrainAvailable(): boolean {
    const result = this.spawn(this.gbrainBin, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  }

  private ensureSource(id: string, sourcePath: string, federated: boolean): { ok: boolean; error?: string } {
    const current = this.listSources();
    const existing = current.find((source) => source.id === id);
    const registeredPath = existing?.local_path ?? existing?.path;
    if (existing && registeredPath && path.resolve(registeredPath) !== path.resolve(sourcePath)) {
      const remove = this.spawn(this.gbrainBin, ['sources', 'remove', id, '--yes'], {
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (remove.status !== 0) {
        return { ok: false, error: remove.stderr?.toString() || remove.stdout?.toString() || `remove exited ${remove.status}` };
      }
    } else if (existing) {
      return { ok: true };
    }

    const addArgs = ['sources', 'add', id, '--path', sourcePath];
    if (federated) {
      addArgs.push('--federated');
    }
    const add = this.spawn(this.gbrainBin, addArgs, {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return add.status === 0
      ? { ok: true }
      : { ok: false, error: add.stderr?.toString() || add.stdout?.toString() || `add exited ${add.status}` };
  }

  private attachSource(id: string, cwd: string): { ok: boolean; error?: string } {
    const attach = this.spawn(this.gbrainBin, ['sources', 'attach', id], {
      encoding: 'utf8',
      timeout: 10_000,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (attach.status !== 0) {
      return { ok: false, error: attach.stderr?.toString() || attach.stdout?.toString() || `attach exited ${attach.status}` };
    }
    const dotfile = path.join(cwd, '.gbrain-source');
    if (!fs.existsSync(dotfile)) {
      fs.writeFileSync(dotfile, `${id}\n`, 'utf8');
    }
    return { ok: true };
  }

  private removeLegacySource(id: string): boolean {
    const remove = this.spawn(this.gbrainBin, ['sources', 'remove', id, '--confirm-destructive'], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return remove.status === 0;
  }

  private sourcePageCount(id: string): number | null {
    const source = this.listSources().find((item) => item.id === id);
    return typeof source?.page_count === 'number' ? source.page_count : null;
  }

  private listSources(): SourceRecord[] {
    const list = this.spawn(this.gbrainBin, ['sources', 'list', '--json'], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (list.status !== 0 || !list.stdout) {
      return [];
    }
    try {
      const parsed = JSON.parse(String(list.stdout)) as { sources?: SourceRecord[] };
      return Array.isArray(parsed.sources) ? parsed.sources : [];
    } catch {
      return [];
    }
  }

  private loadState(): GStackGBrainSyncState {
    if (!fs.existsSync(this.statePath)) {
      return { schema_version: 1, last_writer: 'gstack-gbrain-sync' };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as GStackGBrainSyncState;
      return parsed.schema_version === 1 ? parsed : { schema_version: 1, last_writer: 'gstack-gbrain-sync' };
    } catch {
      return { schema_version: 1, last_writer: 'gstack-gbrain-sync' };
    }
  }

  private saveState(state: GStackGBrainSyncState): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const tmp = `${this.statePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, this.statePath);
  }

  private acquireLock(): boolean {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    if (fs.existsSync(this.lockPath)) {
      const ageMs = Date.now() - fs.statSync(this.lockPath).mtimeMs;
      if (ageMs <= STALE_LOCK_MS) {
        return false;
      }
      fs.rmSync(this.lockPath, { force: true });
    }
    try {
      fs.writeFileSync(this.lockPath, JSON.stringify({
        pid: process.pid,
        started_at: this.now().toISOString(),
      }), { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }

  private releaseLock(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as { pid?: number };
      if (raw.pid === process.pid) {
        fs.rmSync(this.lockPath, { force: true });
      }
    } catch {
      // best effort
    }
  }
}

function defaultToolRoots(cwd: string): ToolRoot[] {
  const workspace = path.dirname(findGitRoot(cwd, spawnSync) ?? cwd);
  return [
    { name: 'gagent', root: path.join(workspace, 'gagent') },
    { name: 'gorchestrator', root: path.join(workspace, 'gorchestrator') },
    { name: 'glearn', root: path.join(workspace, 'glearn') },
    { name: 'gmirror', root: path.join(workspace, 'gmirror') },
    { name: 'GToM', root: path.join(workspace, 'GToM') },
  ];
}

function findGitRoot(cwd: string, spawn: SpawnRunner): string | null {
  const result = spawn('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0 && result.stdout ? String(result.stdout).trim() : null;
}

function constrainSourceId(prefix: string, raw: string): string {
  const max = 32;
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const safeSlug = slug || crypto.createHash('sha1').update(raw || 'empty').digest('hex').slice(0, 8);
  const full = `${prefix}-${safeSlug}`;
  if (full.length <= max) {
    return full;
  }
  const hash = crypto.createHash('sha1').update(safeSlug).digest('hex').slice(0, 6);
  const tailBudget = max - prefix.length - hash.length - 2;
  const tail = safeSlug.slice(-Math.max(1, tailBudget)).replace(/^-+|-+$/g, '');
  return `${prefix}-${tail || hash}-${hash}`;
}

function ok(name: string, summary: string, started: number, detail?: Record<string, unknown>): GStackGBrainStageResult {
  return { name, ran: true, ok: true, duration_ms: Date.now() - started, summary, detail };
}

function fail(name: string, summary: string, started: number, detail?: Record<string, unknown>): GStackGBrainStageResult {
  return { name, ran: true, ok: false, duration_ms: Date.now() - started, summary, detail };
}

function skip(name: string, summary: string, started: number, detail?: Record<string, unknown>): GStackGBrainStageResult {
  return { name, ran: false, ok: true, duration_ms: Date.now() - started, summary, detail };
}

function failSkip(name: string, summary: string, started: number): GStackGBrainStageResult {
  return { name, ran: false, ok: false, duration_ms: Date.now() - started, summary };
}
