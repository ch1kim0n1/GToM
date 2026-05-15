import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type GStackToolName = 'gorchestrator' | 'gmirror' | 'gtom' | 'glearn' | 'gagent';
export type ServiceStatus = 'available' | 'missing';

export interface CrossToolEvent<T = Record<string, unknown>> {
  id: string;
  topic: string;
  source: GStackToolName;
  task_id: string;
  payload: T;
  timestamp: string;
}

export interface ServiceDescriptor {
  name: GStackToolName;
  root: string;
  status: ServiceStatus;
  endpoint?: string;
  package_path?: string;
}

export interface CrossToolTaskResult {
  task_id: string;
  services: ServiceDescriptor[];
  events: CrossToolEvent[];
  completed: boolean;
}

type EventHandler<T = Record<string, unknown>> = (event: CrossToolEvent<T>) => void;

const PIPELINE: GStackToolName[] = ['gorchestrator', 'gmirror', 'gtom', 'glearn', 'gagent'];

const TOPICS: Record<GStackToolName, string> = {
  gorchestrator: 'task.accepted',
  gmirror: 'mirror.checked',
  gtom: 'conflict.predicted',
  glearn: 'learning.recorded',
  gagent: 'agent.ready',
};

export class InProcessCrossToolEventBus {
  private emitter = new EventEmitter();
  private events: CrossToolEvent[] = [];

  publish<T = Record<string, unknown>>(event: Omit<CrossToolEvent<T>, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): CrossToolEvent<T> {
    const enriched: CrossToolEvent<T> = {
      ...event,
      id: event.id ?? `${event.source}-${Date.now()}-${this.events.length + 1}`,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    this.events.push(enriched as CrossToolEvent);
    this.emitter.emit(event.topic, enriched);
    this.emitter.emit('*', enriched);
    return enriched;
  }

  subscribe<T = Record<string, unknown>>(topic: string, handler: EventHandler<T>): () => void {
    this.emitter.on(topic, handler as EventHandler);
    return () => this.emitter.off(topic, handler as EventHandler);
  }

  getEvents(taskId?: string): CrossToolEvent[] {
    return taskId ? this.events.filter((event) => event.task_id === taskId) : [...this.events];
  }
}

export class CrossToolServiceDiscovery {
  private services = new Map<GStackToolName, ServiceDescriptor>();

  constructor(services: ServiceDescriptor[] = []) {
    for (const service of services) {
      this.register(service);
    }
  }

  static fromWorkspace(workspaceRoot = path.resolve(process.cwd(), '..')): CrossToolServiceDiscovery {
    return new CrossToolServiceDiscovery(PIPELINE.map((name) => {
      const root = name === 'gtom'
        ? path.join(workspaceRoot, 'GToM')
        : path.join(workspaceRoot, name);
      const packagePath = path.join(root, 'package.json');
      return {
        name,
        root,
        status: fs.existsSync(packagePath) ? 'available' : 'missing',
        endpoint: process.env[`GSTACK_${name.toUpperCase()}_ENDPOINT`],
        package_path: fs.existsSync(packagePath) ? packagePath : undefined,
      };
    }));
  }

  register(service: ServiceDescriptor): void {
    this.services.set(service.name, service);
  }

  discover(name: GStackToolName): ServiceDescriptor | undefined {
    return this.services.get(name);
  }

  discoverAll(): ServiceDescriptor[] {
    return PIPELINE.map((name) => this.services.get(name)).filter(Boolean) as ServiceDescriptor[];
  }

  requireAll(): ServiceDescriptor[] {
    const services = this.discoverAll();
    const missing = PIPELINE.filter((name) => this.services.get(name)?.status !== 'available');
    if (missing.length > 0) {
      throw new Error(`Missing required g-stack service(s): ${missing.join(', ')}`);
    }
    return services;
  }
}

export async function runCrossToolTask(
  task: { task_id: string; description: string },
  options: {
    eventBus?: InProcessCrossToolEventBus;
    discovery?: CrossToolServiceDiscovery;
    requireAllServices?: boolean;
  } = {},
): Promise<CrossToolTaskResult> {
  const eventBus = options.eventBus ?? new InProcessCrossToolEventBus();
  const discovery = options.discovery ?? CrossToolServiceDiscovery.fromWorkspace();
  const services = options.requireAllServices ? discovery.requireAll() : discovery.discoverAll();

  for (const [index, source] of PIPELINE.entries()) {
    const service = discovery.discover(source);
    if (options.requireAllServices && service?.status !== 'available') {
      throw new Error(`Service ${source} is not available`);
    }
    eventBus.publish({
      topic: TOPICS[source],
      source,
      task_id: task.task_id,
      payload: {
        description: task.description,
        stage: index + 1,
        service_status: service?.status ?? 'missing',
      },
    });
  }

  return {
    task_id: task.task_id,
    services,
    events: eventBus.getEvents(task.task_id),
    completed: eventBus.getEvents(task.task_id).length === PIPELINE.length,
  };
}

