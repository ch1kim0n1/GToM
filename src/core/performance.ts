export interface ProgressEvent {
  operation: string;
  stage: string;
  percent: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type ProgressHandler = (event: ProgressEvent) => void;

export class CancellationToken {
  private cancelled = false;
  private cancelReason = 'Operation cancelled';
  private listeners: Array<(reason: string) => void> = [];

  cancel(reason = 'Operation cancelled'): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.cancelReason = reason;
    for (const listener of this.listeners) listener(reason);
    this.listeners = [];
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  get reason(): string {
    return this.cancelReason;
  }

  throwIfCancelled(): void {
    if (this.cancelled) {
      throw new Error(this.cancelReason);
    }
  }

  onCancel(listener: (reason: string) => void): () => void {
    if (this.cancelled) {
      listener(this.cancelReason);
      return () => undefined;
    }
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((current) => current !== listener);
    };
  }
}

export class ProgressReporter {
  private readonly events: ProgressEvent[] = [];

  constructor(
    private readonly operation: string,
    private readonly handler?: ProgressHandler,
  ) {}

  report(stage: string, percent: number, metadata?: Record<string, unknown>): ProgressEvent {
    const event: ProgressEvent = {
      operation: this.operation,
      stage,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      timestamp: new Date().toISOString(),
      metadata,
    };
    this.events.push(event);
    this.handler?.(event);
    return event;
  }

  getEvents(): ProgressEvent[] {
    return [...this.events];
  }
}

export interface GToMOperationOptions {
  cancellationToken?: CancellationToken;
  onProgress?: ProgressHandler;
  bypassCache?: boolean;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class LRUCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();

  constructor(
    private readonly maxEntries = 256,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  get(key: K, now = Date.now()): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, now = Date.now()): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): { size: number; max_entries: number; ttl_ms: number } {
    return {
      size: this.entries.size,
      max_entries: this.maxEntries,
      ttl_ms: this.ttlMs,
    };
  }
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export class BackpressureController {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrent = 8,
    private readonly maxQueue = 64,
  ) {}

  async acquire(options: { cancellationToken?: CancellationToken } = {}): Promise<() => void> {
    options.cancellationToken?.throwIfCancelled();
    if (this.active < this.maxConcurrent) {
      this.active++;
      return () => this.release();
    }
    if (this.queue.length >= this.maxQueue) {
      throw new Error(`Backpressure limit exceeded: ${this.active} active, ${this.queue.length} queued`);
    }
    return new Promise((resolve, reject) => {
      const cleanup = options.cancellationToken?.onCancel((reason) => {
        this.removeWaiter(waiter);
        reject(new Error(reason));
      }) ?? (() => undefined);
      const waiter: Waiter = { resolve, reject, cleanup };
      this.queue.push(waiter);
    });
  }

  getStats(): { active: number; queued: number; max_concurrent: number; max_queue: number } {
    return {
      active: this.active,
      queued: this.queue.length,
      max_concurrent: this.maxConcurrent,
      max_queue: this.maxQueue,
    };
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (!next) return;
    next.cleanup();
    this.active++;
    next.resolve(() => this.release());
  }

  private removeWaiter(waiter: Waiter): void {
    const index = this.queue.indexOf(waiter);
    if (index >= 0) {
      this.queue.splice(index, 1);
      waiter.cleanup();
    }
  }
}

export interface ModelResolutionTier {
  tier: number;
  name: string;
  model_id: string;
  provider: 'anthropic' | 'openai';
  max_input_tokens: number;
  min_confidence?: number;
  use_case: string;
}

export const MODEL_RESOLUTION_CHAIN_8: ModelResolutionTier[] = [
  { tier: 1, name: 'fast-localized', model_id: 'claude-haiku-4-5-20251001', provider: 'anthropic', max_input_tokens: 2_000, use_case: 'fast safety and low-risk classification' },
  { tier: 2, name: 'fast-openai', model_id: 'gpt-4o-mini', provider: 'openai', max_input_tokens: 4_000, use_case: 'cheap broad compatibility fallback' },
  { tier: 3, name: 'balanced-anthropic', model_id: 'claude-sonnet-4-6', provider: 'anthropic', max_input_tokens: 16_000, use_case: 'default cognitive reasoning' },
  { tier: 4, name: 'balanced-openai', model_id: 'gpt-4o', provider: 'openai', max_input_tokens: 16_000, use_case: 'cross-provider reasoning fallback' },
  { tier: 5, name: 'deep-anthropic', model_id: 'claude-opus-4-7', provider: 'anthropic', max_input_tokens: 64_000, use_case: 'high ambiguity or high-stakes decisions' },
  { tier: 6, name: 'legacy-openai-deep', model_id: 'gpt-4-turbo', provider: 'openai', max_input_tokens: 64_000, use_case: 'legacy long-context fallback' },
  { tier: 7, name: 'legacy-sonnet', model_id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', max_input_tokens: 32_000, use_case: 'known-stable compatibility model' },
  { tier: 8, name: 'legacy-opus', model_id: 'claude-opus-4-6', provider: 'anthropic', max_input_tokens: 64_000, use_case: 'last-resort high-quality fallback' },
];

export interface ModelResolutionRequest {
  estimatedInputTokens: number;
  preferredModel?: string;
  availableProviders: Array<'anthropic' | 'openai'>;
  allowExpensive?: boolean;
}

export function resolveModelFromChain(request: ModelResolutionRequest): ModelResolutionTier {
  if (request.preferredModel) {
    const preferred = MODEL_RESOLUTION_CHAIN_8.find((tier) => tier.model_id === request.preferredModel);
    if (preferred && request.availableProviders.includes(preferred.provider)) return preferred;
  }
  const candidates = MODEL_RESOLUTION_CHAIN_8.filter((tier) =>
    request.availableProviders.includes(tier.provider)
    && request.estimatedInputTokens <= tier.max_input_tokens
    && (request.allowExpensive || tier.tier < 5),
  );
  return candidates[0] ?? MODEL_RESOLUTION_CHAIN_8.find((tier) => request.availableProviders.includes(tier.provider)) ?? MODEL_RESOLUTION_CHAIN_8[0];
}

export interface MemoryProfileSnapshot {
  timestamp: string;
  rss_bytes: number;
  heap_total_bytes: number;
  heap_used_bytes: number;
  external_bytes: number;
  array_buffers_bytes: number;
}

export function captureMemoryProfile(): MemoryProfileSnapshot {
  const usage = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(),
    rss_bytes: usage.rss,
    heap_total_bytes: usage.heapTotal,
    heap_used_bytes: usage.heapUsed,
    external_bytes: usage.external,
    array_buffers_bytes: usage.arrayBuffers,
  };
}
