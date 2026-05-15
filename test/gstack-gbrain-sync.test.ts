import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GStackGBrainSync } from '../src/core/gstack-gbrain-sync.js';

function mkdirp(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeSpawn(repoRoot: string, calls: string[], sourceState: Array<Record<string, unknown>> = []) {
  return ((command: string, args?: readonly string[], options?: any) => {
    const argv = [...(args ?? [])];
    calls.push([command, ...argv].join(' '));

    if (command === 'git' && argv.join(' ') === 'rev-parse --show-toplevel') {
      return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
    }

    if (command === 'gbrain' && argv[0] === '--version') {
      return { status: 0, stdout: 'gbrain 1.0.0\n', stderr: '' };
    }

    if (command === 'gbrain' && argv.join(' ') === 'sources list --json') {
      return { status: 0, stdout: JSON.stringify({ sources: sourceState }), stderr: '' };
    }

    if (command === 'gbrain' && argv[0] === 'sources' && argv[1] === 'add') {
      const id = argv[2];
      const sourcePath = argv[argv.indexOf('--path') + 1];
      sourceState.push({ id, local_path: sourcePath, page_count: 12 });
      return { status: 0, stdout: '', stderr: '' };
    }

    if (command === 'gbrain' && argv[0] === 'sources' && argv[1] === 'remove') {
      const id = argv[2];
      const index = sourceState.findIndex((source) => source.id === id);
      if (index >= 0) sourceState.splice(index, 1);
      return { status: 0, stdout: '', stderr: '' };
    }

    if (command === 'gbrain' && argv[0] === 'sources' && argv[1] === 'attach') {
      fs.writeFileSync(path.join(options.cwd, '.gbrain-source'), `${argv[2]}\n`, 'utf8');
      return { status: 0, stdout: '', stderr: '' };
    }

    if (command === 'gbrain' && (argv[0] === 'sync' || argv[0] === 'reindex-code')) {
      return { status: 0, stdout: '', stderr: '' };
    }

    return { status: 1, stdout: '', stderr: `unexpected ${command} ${argv.join(' ')}` };
  }) as any;
}

describe('GStackGBrainSync', () => {
  it('dry-run emits gstack-compatible code and tools stage previews without writes', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-gbrain-sync-'));
    const repo = mkdirp(path.join(tmp, 'GToM'));
    const tools = [
      { name: 'gagent', root: mkdirp(path.join(tmp, 'gagent')) },
      { name: 'gorchestrator', root: mkdirp(path.join(tmp, 'gorchestrator')) },
    ];
    const calls: string[] = [];
    const sync = new GStackGBrainSync({
      cwd: repo,
      stateDir: path.join(tmp, '.gtom'),
      toolRoots: tools,
      spawn: fakeSpawn(repo, calls),
    });

    const result = await sync.run({ mode: 'dry-run' });
    const output = sync.format(result.stages, 'dry-run');

    expect(result.exitCode).toBe(0);
    expect(output).toContain('gstack-gbrain-sync (dry-run):');
    expect(output).toContain('SKIP  code');
    expect(output).toContain('SKIP  tools');
    expect(output).toMatch(/gstack-code-.+-[a-f0-9]{6,8}/);
    expect(output).toMatch(/gstack-tools-.+-[a-f0-9]{6,8}/);
    expect(fs.existsSync(sync.statePath)).toBe(false);
    expect(fs.existsSync(sync.lockPath)).toBe(false);
  });

  it('registers, attaches, syncs, cleans legacy sources, and atomically writes state', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-gbrain-sync-'));
    const repo = mkdirp(path.join(tmp, 'GToM'));
    const tool = { name: 'gmirror', root: mkdirp(path.join(tmp, 'gmirror')) };
    const calls: string[] = [];
    const sourceState: Array<Record<string, unknown>> = [
      { id: 'gstack-code-gtom', local_path: repo },
      { id: 'gstack-tools-gmirror', local_path: tool.root },
    ];
    const sync = new GStackGBrainSync({
      cwd: repo,
      stateDir: path.join(tmp, '.gtom'),
      toolRoots: [tool],
      spawn: fakeSpawn(repo, calls, sourceState),
      now: () => new Date('2026-05-15T18:00:00.000Z'),
    });

    const result = await sync.run({ mode: 'incremental', quiet: true });

    expect(result.exitCode).toBe(0);
    expect(calls.some((call) => /^gbrain sources remove gstack-code-gtom /.test(call))).toBe(true);
    expect(calls.some((call) => /^gbrain sources remove gstack-tools-gmirror /.test(call))).toBe(true);
    expect(calls.some((call) => /^gbrain sources add gstack-code-/.test(call) && call.includes('--federated'))).toBe(true);
    expect(calls.some((call) => /^gbrain sources add gstack-tools-/.test(call) && call.includes('--federated'))).toBe(true);
    expect(calls.some((call) => /^gbrain sources attach gstack-code-/.test(call))).toBe(true);
    expect(calls.some((call) => /^gbrain sync --strategy code --source gstack-tools-/.test(call))).toBe(true);
    expect(fs.readFileSync(path.join(repo, '.gbrain-source'), 'utf8')).toMatch(/^gstack-code-/);
    expect(fs.readFileSync(path.join(tool.root, '.gbrain-source'), 'utf8')).toMatch(/^gstack-tools-/);
    expect(fs.existsSync(sync.lockPath)).toBe(false);

    const state = JSON.parse(fs.readFileSync(sync.statePath, 'utf8'));
    expect(state.last_writer).toBe('gstack-gbrain-sync');
    expect(state.last_sync).toBe('2026-05-15T18:00:00.000Z');
    expect(state.last_stages.map((stage: any) => stage.name)).toEqual(['code', 'tools']);
  });

  it('blocks concurrent syncs and takes over stale locks after five minutes', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-gbrain-sync-'));
    const repo = mkdirp(path.join(tmp, 'GToM'));
    const stateDir = mkdirp(path.join(tmp, '.gtom'));
    const lockPath = path.join(stateDir, '.gstack-gbrain-sync.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999, started_at: '2026-05-15T17:00:00.000Z' }), 'utf8');
    const freshSync = new GStackGBrainSync({
      cwd: repo,
      stateDir,
      toolRoots: [],
      spawn: fakeSpawn(repo, []),
    });

    const blocked = await freshSync.run({ mode: 'incremental', noCode: true });
    expect(blocked.exitCode).toBe(2);
    expect(blocked.stages[0].name).toBe('lock');

    const staleTime = Date.now() - (6 * 60 * 1000);
    fs.utimesSync(lockPath, staleTime / 1000, staleTime / 1000);
    const staleSync = new GStackGBrainSync({
      cwd: repo,
      stateDir,
      toolRoots: [],
      spawn: fakeSpawn(repo, []),
    });

    const recovered = await staleSync.run({ mode: 'incremental', noCode: true });
    expect(recovered.exitCode).toBe(0);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
