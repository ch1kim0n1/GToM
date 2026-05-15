import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CrossToolServiceDiscovery,
  InProcessCrossToolEventBus,
  runCrossToolTask,
  type GStackToolName,
} from '../src/core/cross-tool-integration';

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-cross-tool-'));
  const repos: Array<[GStackToolName, string]> = [
    ['gorchestrator', 'gorchestrator'],
    ['gmirror', 'gmirror'],
    ['gtom', 'GToM'],
    ['glearn', 'glearn'],
    ['gagent', 'gagent'],
  ];
  for (const [name, dir] of repos) {
    const repoRoot = path.join(root, dir);
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ name }), 'utf8');
  }
  return root;
}

describe('cross-tool integration', () => {
  it('discovers all five g-stack services from one workspace', () => {
    const discovery = CrossToolServiceDiscovery.fromWorkspace(createWorkspace());
    const services = discovery.requireAll();

    expect(services.map((service) => service.name)).toEqual([
      'gorchestrator',
      'gmirror',
      'gtom',
      'glearn',
      'gagent',
    ]);
    expect(services.every((service) => service.status === 'available')).toBe(true);
  });

  it('publishes a single task through gorchestrator, gmirror, GToM, glearn, and gagent', async () => {
    const discovery = CrossToolServiceDiscovery.fromWorkspace(createWorkspace());
    const eventBus = new InProcessCrossToolEventBus();
    const seen: string[] = [];
    const unsubscribe = eventBus.subscribe('*', (event) => {
      seen.push(`${event.source}:${event.topic}`);
    });

    const result = await runCrossToolTask({
      task_id: 'task-cross-tool-1',
      description: 'Implement a small change and learn from the result',
    }, {
      discovery,
      eventBus,
      requireAllServices: true,
    });
    unsubscribe();

    expect(result.completed).toBe(true);
    expect(result.events).toHaveLength(5);
    expect(seen).toEqual([
      'gorchestrator:task.accepted',
      'gmirror:mirror.checked',
      'gtom:conflict.predicted',
      'glearn:learning.recorded',
      'gagent:agent.ready',
    ]);
    expect(result.events.every((event) => event.task_id === 'task-cross-tool-1')).toBe(true);
  });
});
