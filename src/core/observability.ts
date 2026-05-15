import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ObservabilityLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LocalLogEntry {
  timestamp: string;
  level: ObservabilityLogLevel;
  logger: string;
  message: string;
  context?: Record<string, unknown>;
  trace_id?: string;
  span_id?: string;
}

export interface SpanContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error';
  error?: string;
}

export interface ShellJobAuditEntry {
  job_id: string;
  command: string;
  cwd?: string;
  status: 'started' | 'succeeded' | 'failed';
  exit_code?: number;
  duration_ms?: number;
  trace_id?: string;
  span_id?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface DecisionAuditEntry {
  decision_id?: string;
  operation: string;
  input_hash?: string;
  verdict?: string;
  score?: number;
  trace_id?: string;
  span_id?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityAuditEntry {
  event_type: string;
  actor?: string;
  resource?: string;
  scopes?: string[];
  required_scopes?: string[];
  trace_id?: string;
  span_id?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

const PII_KEY_PATTERN = /(email|phone|token|secret|password|api[_-]?key|authorization|ssn|session|cookie)/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TOKEN_PATTERN = /\b(?:sk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_=-]{16,}\b/g;

export function redactPII<T>(value: T): T {
  return redactValue(value) as T;
}

export class LocalLogger {
  private readonly name: string;
  private readonly sink: (line: string) => void;

  constructor(name: string, sink: (line: string) => void = (line) => process.stderr.write(`${line}\n`)) {
    this.name = name;
    this.sink = sink;
  }

  debug(message: string, context?: Record<string, unknown>, span?: SpanContext): void {
    this.write('debug', message, context, span);
  }

  info(message: string, context?: Record<string, unknown>, span?: SpanContext): void {
    this.write('info', message, context, span);
  }

  warn(message: string, context?: Record<string, unknown>, span?: SpanContext): void {
    this.write('warn', message, context, span);
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>, span?: SpanContext): void {
    this.write('error', message, {
      ...(context ?? {}),
      error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    }, span);
  }

  fatal(message: string, error?: unknown, context?: Record<string, unknown>, span?: SpanContext): void {
    this.write('fatal', message, {
      ...(context ?? {}),
      error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    }, span);
  }

  private write(level: ObservabilityLogLevel, message: string, context?: Record<string, unknown>, span?: SpanContext): void {
    const entry: LocalLogEntry = redactPII({
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message,
      context,
      trace_id: span?.trace_id,
      span_id: span?.span_id,
    });
    this.sink(JSON.stringify(entry));
  }
}

export class LocalAuditLogger {
  private readonly auditDir: string;

  constructor(toolName = 'gtom', baseDir = os.homedir()) {
    this.auditDir = path.join(baseDir, `.${toolName}`, 'audit');
  }

  recordDecision(entry: DecisionAuditEntry): void {
    this.append(`decisions-${isoWeekKey(new Date(entry.timestamp ?? Date.now()))}.jsonl`, {
      schema_version: 1,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      ...entry,
    });
  }

  recordShellJob(entry: ShellJobAuditEntry): void {
    this.append(`shell-jobs-${isoWeekKey(new Date(entry.timestamp ?? Date.now()))}.jsonl`, {
      schema_version: 1,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      ...entry,
    });
  }

  recordSecurityEvent(entry: SecurityAuditEntry): void {
    this.append(`security-events-${isoWeekKey(new Date(entry.timestamp ?? Date.now()))}.jsonl`, {
      schema_version: 1,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      ...entry,
    });
  }

  getAuditDir(): string {
    return this.auditDir;
  }

  private append(fileName: string, entry: Record<string, unknown>): void {
    fs.mkdirSync(this.auditDir, { recursive: true });
    fs.appendFileSync(path.join(this.auditDir, fileName), `${JSON.stringify(redactPII(entry))}\n`, 'utf8');
  }
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  incrementCounter(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  recordLatency(method: string, latencyMs: number): void {
    const key = `gtom_method_latency_ms:${method}`;
    const values = this.histograms.get(key) ?? [];
    values.push(latencyMs);
    if (values.length > 1000) values.splice(0, values.length - 1000);
    this.histograms.set(key, values);
  }

  recordThroughput(method: string): void {
    this.incrementCounter(`gtom_method_calls_total:${method}`);
  }

  recordError(method: string): void {
    this.incrementCounter(`gtom_method_errors_total:${method}`);
  }

  getSnapshot(): Record<string, unknown> {
    const histograms: Record<string, unknown> = {};
    for (const [key, values] of this.histograms.entries()) {
      histograms[key] = summarize(values);
    }
    return {
      counters: Object.fromEntries(this.counters),
      histograms,
    };
  }

  exportPrometheus(): string {
    const lines: string[] = [
      '# HELP gtom_method_calls_total Total public method calls.',
      '# TYPE gtom_method_calls_total counter',
    ];
    for (const [key, value] of this.counters.entries()) {
      const [metric, method = 'unknown'] = key.split(':');
      lines.push(`${metric}{method="${escapePrometheusLabel(method)}"} ${value}`);
    }
    lines.push('# HELP gtom_method_latency_ms Public method latency quantiles.');
    lines.push('# TYPE gtom_method_latency_ms summary');
    for (const [key, values] of this.histograms.entries()) {
      const [, method = 'unknown'] = key.split(':');
      const stats = summarize(values);
      lines.push(`gtom_method_latency_ms{method="${escapePrometheusLabel(method)}",quantile="0.50"} ${stats.p50}`);
      lines.push(`gtom_method_latency_ms{method="${escapePrometheusLabel(method)}",quantile="0.95"} ${stats.p95}`);
      lines.push(`gtom_method_latency_ms{method="${escapePrometheusLabel(method)}",quantile="0.99"} ${stats.p99}`);
      lines.push(`gtom_method_latency_ms_count{method="${escapePrometheusLabel(method)}"} ${stats.count}`);
      lines.push(`gtom_method_latency_ms_sum{method="${escapePrometheusLabel(method)}"} ${stats.sum}`);
    }
    return `${lines.join('\n')}\n`;
  }

  exportOpenTelemetry(): Record<string, unknown> {
    const metrics: Array<Record<string, unknown>> = [];
    for (const [key, value] of this.counters.entries()) {
      const [name, method = 'unknown'] = key.split(':');
      metrics.push({ name, type: 'counter', value, attributes: { method } });
    }
    for (const [key, values] of this.histograms.entries()) {
      const [, method = 'unknown'] = key.split(':');
      metrics.push({ name: 'gtom_method_latency_ms', type: 'histogram', summary: summarize(values), attributes: { method } });
    }
    return {
      resource: { service_name: 'gtom' },
      exported_at: new Date().toISOString(),
      metrics,
    };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

export class Tracer {
  private readonly completedSpans: SpanContext[] = [];

  startSpan(name: string, attributes: Record<string, unknown> = {}, parent?: SpanContext): SpanContext {
    return {
      trace_id: String(attributes.trace_id ?? parent?.trace_id ?? randomUUID()),
      span_id: randomUUID(),
      parent_span_id: parent?.span_id,
      name,
      started_at: new Date().toISOString(),
      attributes: redactPII(attributes),
      status: 'ok',
    };
  }

  endSpan(span: SpanContext, error?: unknown): SpanContext {
    const endedAt = new Date();
    const startedAt = new Date(span.started_at);
    const completed: SpanContext = {
      ...span,
      ended_at: endedAt.toISOString(),
      duration_ms: endedAt.getTime() - startedAt.getTime(),
      status: error ? 'error' : 'ok',
      error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    };
    this.completedSpans.push(redactPII(completed));
    if (this.completedSpans.length > 1000) {
      this.completedSpans.splice(0, this.completedSpans.length - 1000);
    }
    return completed;
  }

  getCompletedSpans(): SpanContext[] {
    return [...this.completedSpans];
  }
}

export class Observability {
  readonly logger: LocalLogger;
  readonly audit: LocalAuditLogger;
  readonly metrics: MetricsRegistry;
  readonly tracer: Tracer;

  constructor(toolName = 'gtom', baseDir = os.homedir()) {
    this.logger = new LocalLogger(toolName);
    this.audit = new LocalAuditLogger(toolName, baseDir);
    this.metrics = new MetricsRegistry();
    this.tracer = new Tracer();
  }

  async timeAsync<T>(method: string, operation: (span: SpanContext) => Promise<T>, attributes: Record<string, unknown> = {}): Promise<T> {
    const span = this.tracer.startSpan(method, attributes);
    const start = performance.now();
    this.metrics.recordThroughput(method);
    try {
      const result = await operation(span);
      this.metrics.recordLatency(method, performance.now() - start);
      this.tracer.endSpan(span);
      return result;
    } catch (error) {
      this.metrics.recordError(method);
      this.metrics.recordLatency(method, performance.now() - start);
      this.tracer.endSpan(span, error);
      this.logger.error(`${method} failed`, error, { method }, span);
      throw error;
    }
  }

  timeSync<T>(method: string, operation: (span: SpanContext) => T, attributes: Record<string, unknown> = {}): T {
    const span = this.tracer.startSpan(method, attributes);
    const start = performance.now();
    this.metrics.recordThroughput(method);
    try {
      const result = operation(span);
      this.metrics.recordLatency(method, performance.now() - start);
      this.tracer.endSpan(span);
      return result;
    } catch (error) {
      this.metrics.recordError(method);
      this.metrics.recordLatency(method, performance.now() - start);
      this.tracer.endSpan(span, error);
      this.logger.error(`${method} failed`, error, { method }, span);
      throw error;
    }
  }

  snapshot(): Record<string, unknown> {
    return {
      metrics: this.metrics.getSnapshot(),
      traces: this.tracer.getCompletedSpans(),
      audit_dir: this.audit.getAuditDir(),
    };
  }
}

export const globalObservability = new Observability('gtom');

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]').replace(TOKEN_PATTERN, '[REDACTED_TOKEN]');
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = PII_KEY_PATTERN.test(key) ? '[REDACTED]' : redactValue(child);
    }
    return output;
  }
  return value;
}

function summarize(values: number[]): { count: number; sum: number; p50: number; p95: number; p99: number } {
  if (values.length === 0) {
    return { count: 0, sum: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    sum: roundMetric(sum),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: number[], quantile: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return roundMetric(sorted[index]);
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapePrometheusLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function isoWeekKey(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
