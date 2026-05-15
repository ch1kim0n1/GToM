import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as lockfile from 'proper-lockfile';
import { Pool } from 'pg';
import { ExecutionReceipt } from '../types/quality-rubric.js';
import { globalObservability } from './observability.js';
import { defaultSecretManager } from './secret-manager.js';
import {
  API_STABILITY,
  CURRENT_RECEIPT_SCHEMA_VERSION,
  RECEIPT_SCHEMA_MIGRATIONS,
  isSupportedReceiptSchemaVersion,
} from './versioning.js';

const DEFAULT_RECEIPT_TTL_DAYS = 365;
const DEFAULT_ARCHIVE_AFTER_DAYS = 28;
const SIGNATURE_FIELDS = new Set([
  'receipt_signature',
  'receipt_signed_at',
  'receipt_expires_at',
  'receipt_expired',
  'signature_key_id',
]);

function normalizeProjectName(projectName: string): string {
  const normalized = projectName.trim().toLowerCase();
  if (!normalized) {
    throw new Error('ReceiptRegistry requires a non-empty project name');
  }
  return normalized.replace(/[^a-z0-9._-]/g, '-');
}

export interface ReceiptRegistryOptions {
  baseDir?: string;
  hmacSecret?: string;
  ttlDays?: number;
  archiveAfterDays?: number;
  postgresUrl?: string | null;
}

export interface ReceiptDiff {
  receipt_a: string;
  receipt_b: string;
  changed: boolean;
  verdict: { from: string; to: string; changed: boolean };
  overall_score_delta: number;
  cost_usd_delta: number;
  score_deltas: Record<string, number>;
  hard_gates: { from: boolean; to: boolean; changed: boolean };
}

export interface RegressionResult {
  baseline_receipt_id: string;
  current_receipt_id: string;
  tolerance: number;
  dimension_tolerances: Record<string, number>;
  regressed: boolean;
  reasons: string[];
  score_delta: number;
  dimension_comparisons: Record<string, {
    baseline_score: number;
    current_score: number;
    delta: number;
    tolerance: number;
    baseline_wilson_95_ci: { lower: number; upper: number };
    current_wilson_95_ci: { lower: number; upper: number };
    regressed: boolean;
  }>;
  cost_regression: {
    baseline_cost_usd: number;
    current_cost_usd: number;
    delta_usd: number;
    tolerance_usd: number;
    regressed: boolean;
  };
  latency_regression: {
    baseline_latency_ms: number | null;
    current_latency_ms: number | null;
    delta_ms: number | null;
    tolerance_ms: number;
    regressed: boolean;
  };
  metric_comparisons: Record<string, {
    baseline_value: number;
    current_value: number;
    delta: number;
    tolerance: number;
    baseline_wilson_95_ci: { lower: number; upper: number };
    current_wilson_95_ci: { lower: number; upper: number };
    regressed: boolean;
  }>;
}

export interface RegressionToleranceConfig {
  defaultScoreTolerance?: number;
  dimensionTolerances?: Record<string, number>;
  costToleranceUsd?: number;
  costTolerancePct?: number;
  latencyToleranceMs?: number;
  latencyTolerancePct?: number;
  metricTolerances?: Record<string, number>;
  sampleSize?: number;
}

/**
 * Simple PII redaction for receipts
 */
function redactPII(receipt: any): any {
  if (!receipt || typeof receipt !== 'object') {
    return receipt;
  }

  const redacted = { ...receipt };
  
  // Redact email addresses
  if (redacted.user_email) {
    redacted.user_email = '[REDACTED]';
  }
  
  // Redact API keys
  if (redacted.api_key) {
    redacted.api_key = '[REDACTED]';
  }
  
  // Redact sensitive fields recursively
  for (const key in redacted) {
    if (typeof redacted[key] === 'string') {
      // Redact potential API keys (32+ char alphanumeric strings)
      if (redacted[key].length >= 32 && /^[a-zA-Z0-9]+$/.test(redacted[key])) {
        redacted[key] = '[REDACTED]';
      }
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactPII(redacted[key]);
    }
  }
  
  return redacted;
}

export class ReceiptRegistry {
  private static appendQueues = new Map<string, Promise<void>>();

  private basePath: string;
  private baseDir: string;
  private schemaPath: string;
  private week: string;  // ISO week YYYY-Www
  private readonly schemaVersion = CURRENT_RECEIPT_SCHEMA_VERSION;
  private readonly hmacSecret: string;
  private readonly ttlDays: number;
  private readonly archiveAfterDays: number;
  private readonly initPromise: Promise<void>;
  private readonly postgresUrl: string | null;
  private postgresPool: Pool | null = null;

  constructor(projectName: string, options: ReceiptRegistryOptions = {}) {
    const now = new Date();
    const year = now.getFullYear();
    const weekNum = getISOWeek(now);
    const normalizedProjectName = normalizeProjectName(projectName);
    this.week = `${year}-W${String(weekNum).padStart(2, '0')}`;
    this.baseDir = options.baseDir ?? path.join(process.cwd(), normalizedProjectName, 'test', 'baselines');
    this.basePath = path.join(this.baseDir, `receipts-${this.week}.jsonl`);
    this.schemaPath = path.join(this.baseDir, `schema.json`);
    this.hmacSecret = options.hmacSecret
      ?? defaultSecretManager.getSecret('GTOM_RECEIPT_HMAC_SECRET')
      ?? 'gtom-dev-receipt-secret';
    this.ttlDays = options.ttlDays ?? parseInt(process.env.GTOM_RECEIPT_TTL_DAYS ?? `${DEFAULT_RECEIPT_TTL_DAYS}`, 10);
    this.archiveAfterDays = options.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS;
    this.postgresUrl = options.postgresUrl === undefined
      ? process.env.GTOM_RECEIPT_POSTGRES_URL ?? null
      : options.postgresUrl;
    
    // Initialize persistence - fail loudly if cannot create directory
    this.initPromise = this.initializePersistence();
  }

  private async initializePersistence(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.open(this.basePath, 'a').then((handle) => handle.close());
      
      // Initialize schema metadata
      await this.initializeSchema();
    } catch (error) {
      throw new Error(`Persistence initialization failed: ${error}. Persistence is REQUIRED for GToM.`);
    }
  }

  private async initializeSchema(): Promise<void> {
    try {
      const existingSchema = await this.readSchema();
      if (existingSchema && existingSchema.version !== this.schemaVersion) {
        globalObservability.logger.warn('Receipt schema version mismatch; migration may be required', {
          expected_version: this.schemaVersion,
          actual_version: existingSchema.version,
        });
        await this.writeSchema(existingSchema.created_at);
      }
      
      if (!existingSchema) {
        await this.writeSchema();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.writeSchema();
      } else {
        throw error;
      }
    }
  }

  private async readSchema(): Promise<{ version: number; created_at: string } | null> {
    try {
      const content = await fs.readFile(this.schemaPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async writeSchema(createdAt = new Date().toISOString()): Promise<void> {
    const schema = {
      version: this.schemaVersion,
      current_schema_version: this.schemaVersion,
      migrations: RECEIPT_SCHEMA_MIGRATIONS,
      created_at: createdAt,
    };
    await fs.writeFile(this.schemaPath, JSON.stringify(schema, null, 2), 'utf8');
  }

  async append(receipt: ExecutionReceipt): Promise<void> {
    const previous = ReceiptRegistry.appendQueues.get(this.basePath) ?? Promise.resolve();
    const current = previous.then(() => this.appendWithLock(receipt));
    ReceiptRegistry.appendQueues.set(this.basePath, current.catch(() => undefined));
    return current;
  }

  private async appendWithLock(receipt: ExecutionReceipt): Promise<void> {
    await this.initPromise;
    await this.archiveOldReceipts();

    // Apply PII redaction before writing
    const redactedReceipt = this.signReceipt(redactPII(receipt));
    const line = JSON.stringify(redactedReceipt) + '\n';

    const release = await lockfile.lock(this.basePath, {
      retries: {
        retries: 5,
        factor: 1.2,
        minTimeout: 25,
        maxTimeout: 100,
      },
    });

    try {
      await fs.appendFile(this.basePath, line, 'utf8');
    } finally {
      await release();
    }

    await this.appendDurable(redactedReceipt);
  }

  async getLatest(): Promise<ExecutionReceipt | null> {
    await this.initPromise;
    const receipts = await this.readAllReceipts();
    if (receipts.length === 0) return null;
    return receipts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  }

  async getSchemaMetadata(): Promise<{
    version: number;
    current_schema_version: number;
    created_at: string;
    migrations: Array<{ from: number; to: number; description: string }>;
  }> {
    await this.initPromise;
    const schema = await this.readSchema();
    if (!schema) {
      throw new Error('Receipt schema metadata is missing');
    }
    return {
      version: schema.version,
      current_schema_version: this.schemaVersion,
      created_at: schema.created_at,
      migrations: Array.isArray((schema as any).migrations) ? (schema as any).migrations : [],
    };
  }

  getAppendQueueDepth(): number {
    return ReceiptRegistry.appendQueues.has(this.basePath) ? 1 : 0;
  }

  async getAllBetween(start: Date, end: Date): Promise<ExecutionReceipt[]> {
    await this.initPromise;
    const receipts = await this.readAllReceipts();
    return receipts.filter((receipt) => {
      const timestamp = new Date(receipt.timestamp);
      return timestamp >= start && timestamp <= end;
    });
  }

  async getAllSince(start: Date): Promise<ExecutionReceipt[]> {
    return this.getAllBetween(start, new Date());
  }

  async getByCorpusSha8(corpusSha8: string): Promise<ExecutionReceipt[]> {
    await this.initPromise;
    const target = corpusSha8.toLowerCase();
    const receipts = await this.readAllReceipts();
    return receipts.filter((receipt) => {
      const metadataSha = typeof receipt.metadata?.corpus_sha8 === 'string'
        ? receipt.metadata.corpus_sha8.toLowerCase()
        : '';
      return metadataSha === target || receipt.input_hash.toLowerCase().startsWith(target);
    });
  }

  async archiveOldReceipts(now: Date = new Date()): Promise<void> {
    await this.initPromise;
    const cutoff = now.getTime() - this.archiveAfterDays * 24 * 60 * 60 * 1000;
    let content = '';
    try {
      content = await fs.readFile(this.basePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    const lines = content.split('\n').filter(Boolean);
    const keep: string[] = [];
    const archive: string[] = [];

    for (const line of lines) {
      const receipt = this.parseReceiptLine(line);
      if (new Date(receipt.timestamp).getTime() < cutoff) {
        archive.push(line);
      } else {
        keep.push(line);
      }
    }

    if (archive.length === 0) return;

    const archiveDir = path.join(this.baseDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, `receipts-${this.week}.jsonl`);

    const release = await lockfile.lock(this.basePath, {
      retries: { retries: 5, minTimeout: 25, maxTimeout: 100 },
    });

    try {
      await fs.appendFile(archivePath, `${archive.join('\n')}\n`, 'utf8');
      await fs.writeFile(this.basePath, keep.length > 0 ? `${keep.join('\n')}\n` : '', 'utf8');
    } finally {
      await release();
    }
  }

  async readReceiptFile(receiptPath: string): Promise<ExecutionReceipt> {
    await this.initPromise;
    return readReceiptFile(receiptPath, this.hmacSecret);
  }

  private signReceipt(receipt: ExecutionReceipt): ExecutionReceipt {
    const expiresAt = new Date(new Date(receipt.timestamp).getTime() + this.ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const enriched: ExecutionReceipt = {
      ...receipt,
      schema_version: CURRENT_RECEIPT_SCHEMA_VERSION,
      metadata: {
        ...receipt.metadata,
        api_stability: receipt.metadata?.api_stability ?? API_STABILITY.receipts.level,
        rubric_version: receipt.metadata?.rubric_version ?? receipt.rubric_name,
        corpus_sha8: receipt.metadata?.corpus_sha8 ?? receipt.input_hash.substring(0, 8),
        receipt_expires_at: expiresAt,
        receipt_signed_at: new Date().toISOString(),
        signature_key_id: 'gtom-hmac-v1',
      },
    };
    return {
      ...enriched,
      metadata: {
        ...enriched.metadata,
        receipt_signature: signReceiptPayload(enriched, this.hmacSecret),
      },
    };
  }

  private parseReceiptLine(line: string): ExecutionReceipt {
    const parsed = JSON.parse(line);
    verifyReceiptSignature(parsed, this.hmacSecret);
    const receipt = migrateReceipt(parsed);
    return markExpiration(receipt);
  }

  private async readAllReceipts(): Promise<ExecutionReceipt[]> {
    const files = await this.getReceiptFiles();
    const receipts: ExecutionReceipt[] = [];

    for (const file of files) {
      let content = '';
      try {
        content = await fs.readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const line of content.split('\n').filter(Boolean)) {
        receipts.push(this.parseReceiptLine(line));
      }
    }

    return receipts;
  }

  private async getReceiptFiles(): Promise<string[]> {
    const files: string[] = [];

    async function collect(dir: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await collect(entryPath);
          } else if (/^receipts-.+\.jsonl$/.test(entry.name)) {
            files.push(entryPath);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    await collect(this.baseDir);
    return files;
  }

  private async appendDurable(receipt: ExecutionReceipt): Promise<void> {
    if (!this.postgresUrl) return;

    if (!this.postgresPool) {
      this.postgresPool = new Pool({
        connectionString: this.postgresUrl,
        connectionTimeoutMillis: 2000,
      });
    }

    await this.postgresPool.query(`
      CREATE TABLE IF NOT EXISTS gtom_receipts (
        receipt_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        corpus_sha8 TEXT NOT NULL,
        receipt JSONB NOT NULL
      )
    `);
    await this.postgresPool.query(
      `
        INSERT INTO gtom_receipts (receipt_id, schema_version, timestamp, corpus_sha8, receipt)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (receipt_id) DO UPDATE
        SET receipt = EXCLUDED.receipt,
            schema_version = EXCLUDED.schema_version,
            timestamp = EXCLUDED.timestamp,
            corpus_sha8 = EXCLUDED.corpus_sha8
      `,
      [
        receipt.receipt_id,
        receipt.schema_version,
        receipt.timestamp,
        receipt.metadata?.corpus_sha8 ?? receipt.input_hash.substring(0, 8),
        receipt,
      ]
    );
  }
}

export async function readReceiptFile(receiptPath: string, hmacSecret = process.env.GTOM_RECEIPT_HMAC_SECRET ?? 'gtom-dev-receipt-secret'): Promise<ExecutionReceipt> {
  const content = await fs.readFile(receiptPath, 'utf8');
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error(`Receipt file is empty: ${receiptPath}`);
  }
  const firstLine = trimmed.split('\n').filter(Boolean)[0];
  const parsed = JSON.parse(firstLine);
  verifyReceiptSignature(parsed, hmacSecret);
  const receipt = migrateReceipt(parsed);
  return markExpiration(receipt);
}

export function migrateReceipt(raw: any): ExecutionReceipt {
  return migrateReceiptToVersion(raw, CURRENT_RECEIPT_SCHEMA_VERSION);
}

export function migrateReceiptToVersion(raw: any, targetVersion: number = CURRENT_RECEIPT_SCHEMA_VERSION, migratedAt = new Date().toISOString()): ExecutionReceipt {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid receipt payload');
  }

  if (!isSupportedReceiptSchemaVersion(targetVersion)) {
    throw new Error(`Unsupported target receipt schema_version ${targetVersion}`);
  }

  let receipt = { ...raw };
  let version = receipt.schema_version ?? 0;
  if (version > CURRENT_RECEIPT_SCHEMA_VERSION) {
    throw new Error(`Unsupported receipt schema_version ${version}`);
  }
  if (version > targetVersion) {
    throw new Error(`Downgrading receipt schema_version ${version} to ${targetVersion} is not supported`);
  }

  while (version < targetVersion) {
    if (version === 0) {
      receipt = migrateReceiptFrom0To1(receipt, migratedAt);
      version = 1;
      continue;
    }
    if (version === 1) {
      receipt = migrateReceiptFrom1To2(receipt, migratedAt);
      version = 2;
      continue;
    }
    throw new Error(`No migration path from receipt schema_version ${version} to ${targetVersion}`);
  }

  return receipt as ExecutionReceipt;
}

export function verifyReceiptSignature(receipt: ExecutionReceipt, hmacSecret = process.env.GTOM_RECEIPT_HMAC_SECRET ?? 'gtom-dev-receipt-secret'): boolean {
  const signature = receipt.metadata?.receipt_signature;
  if (!signature) {
    return false;
  }

  const expected = signReceiptPayload(receipt, hmacSecret);
  const actualBuffer = Buffer.from(String(signature), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error(`Receipt signature verification failed for ${receipt.receipt_id}`);
  }
  return true;
}

export function diffReceipts(a: ExecutionReceipt, b: ExecutionReceipt): ReceiptDiff {
  const dimensions = new Set([...Object.keys(a.scores), ...Object.keys(b.scores)]);
  const scoreDeltas: Record<string, number> = {};
  for (const dimension of dimensions) {
    scoreDeltas[dimension] = roundDelta((b.scores[dimension]?.score ?? 0) - (a.scores[dimension]?.score ?? 0));
  }

  return {
    receipt_a: a.receipt_id,
    receipt_b: b.receipt_id,
    changed: a.verdict !== b.verdict ||
      a.hard_gates_passed !== b.hard_gates_passed ||
      a.overall_score !== b.overall_score ||
      a.cost_usd !== b.cost_usd ||
      Object.values(scoreDeltas).some((delta) => delta !== 0),
    verdict: { from: a.verdict, to: b.verdict, changed: a.verdict !== b.verdict },
    overall_score_delta: roundDelta(b.overall_score - a.overall_score),
    cost_usd_delta: roundDelta(b.cost_usd - a.cost_usd),
    score_deltas: scoreDeltas,
    hard_gates: { from: a.hard_gates_passed, to: b.hard_gates_passed, changed: a.hard_gates_passed !== b.hard_gates_passed },
  };
}

export function compareReceiptRegression(current: ExecutionReceipt, baseline: ExecutionReceipt, toleranceOrConfig: number | RegressionToleranceConfig = 0.05): RegressionResult {
  const config: RegressionToleranceConfig = typeof toleranceOrConfig === 'number'
    ? { defaultScoreTolerance: toleranceOrConfig }
    : toleranceOrConfig;
  const defaultScoreTolerance = Math.abs(config.defaultScoreTolerance ?? 0.05);
  const dimensions = new Set([...Object.keys(baseline.scores), ...Object.keys(current.scores)]);
  const dimensionComparisons: RegressionResult['dimension_comparisons'] = {};
  const reasons: string[] = [];
  const scoreDelta = current.overall_score - baseline.overall_score;
  const sampleSize = config.sampleSize ?? inferComparisonSampleSize(current, baseline);

  if (scoreDelta < -defaultScoreTolerance) {
    reasons.push(`overall_score dropped by ${Math.abs(scoreDelta).toFixed(4)} (tolerance ${defaultScoreTolerance.toFixed(4)})`);
  }
  if (baseline.hard_gates_passed && !current.hard_gates_passed) {
    reasons.push('hard gates passed in baseline but failed in current receipt');
  }
  if (verdictRank(current.verdict) < verdictRank(baseline.verdict)) {
    reasons.push(`verdict regressed from ${baseline.verdict} to ${current.verdict}`);
  }

  for (const dimension of dimensions) {
    const baselineScore = baseline.scores[dimension]?.score ?? 0;
    const currentScore = current.scores[dimension]?.score ?? 0;
    const tolerance = Math.abs(config.dimensionTolerances?.[dimension] ?? defaultScoreTolerance);
    const delta = currentScore - baselineScore;
    const baselineCi = wilsonInterval(Math.round(baselineScore * sampleSize), sampleSize);
    const currentCi = wilsonInterval(Math.round(currentScore * sampleSize), sampleSize);
    const pointRegression = delta < -tolerance;
    const ciRegression = currentCi.upper < baselineCi.lower - tolerance;
    const regressed = pointRegression || ciRegression;

    dimensionComparisons[dimension] = {
      baseline_score: baselineScore,
      current_score: currentScore,
      delta: roundDelta(delta),
      tolerance,
      baseline_wilson_95_ci: baselineCi,
      current_wilson_95_ci: currentCi,
      regressed,
    };

    if (regressed) {
      reasons.push(`${dimension} score regressed by ${Math.abs(delta).toFixed(4)} (tolerance ${tolerance.toFixed(4)})`);
    }
  }

  const costTolerance = Math.max(
    config.costToleranceUsd ?? 0,
    baseline.cost_usd * (config.costTolerancePct ?? 0)
  );
  const costDelta = current.cost_usd - baseline.cost_usd;
  const costRegression = {
    baseline_cost_usd: baseline.cost_usd,
    current_cost_usd: current.cost_usd,
    delta_usd: roundDelta(costDelta),
    tolerance_usd: roundDelta(costTolerance),
    regressed: costDelta > costTolerance,
  };
  if (costRegression.regressed) {
    reasons.push(`cost_usd increased by ${costRegression.delta_usd.toFixed(4)} (tolerance ${costRegression.tolerance_usd.toFixed(4)})`);
  }

  const baselineLatency = numericMetadata(baseline, 'latency_ms');
  const currentLatency = numericMetadata(current, 'latency_ms');
  const latencyTolerance = Math.max(
    config.latencyToleranceMs ?? 0,
    (baselineLatency ?? 0) * (config.latencyTolerancePct ?? 0)
  );
  const latencyDelta = baselineLatency === null || currentLatency === null ? null : currentLatency - baselineLatency;
  const latencyRegression = {
    baseline_latency_ms: baselineLatency,
    current_latency_ms: currentLatency,
    delta_ms: latencyDelta === null ? null : roundDelta(latencyDelta),
    tolerance_ms: roundDelta(latencyTolerance),
    regressed: latencyDelta !== null && latencyDelta > latencyTolerance,
  };
  if (latencyRegression.regressed && latencyDelta !== null) {
    reasons.push(`latency_ms increased by ${latencyDelta.toFixed(2)} (tolerance ${latencyTolerance.toFixed(2)})`);
  }

  const metricComparisons: RegressionResult['metric_comparisons'] = {};
  for (const [metric, tolerance] of Object.entries(config.metricTolerances ?? {})) {
    const baselineValue = numericMetadata(baseline, metric);
    const currentValue = numericMetadata(current, metric);
    if (baselineValue === null || currentValue === null) continue;
    const delta = currentValue - baselineValue;
    const baselineCi = wilsonInterval(Math.round(baselineValue * sampleSize), sampleSize);
    const currentCi = wilsonInterval(Math.round(currentValue * sampleSize), sampleSize);
    const regressed = delta < -Math.abs(tolerance) || currentCi.upper < baselineCi.lower - Math.abs(tolerance);

    metricComparisons[metric] = {
      baseline_value: baselineValue,
      current_value: currentValue,
      delta: roundDelta(delta),
      tolerance: Math.abs(tolerance),
      baseline_wilson_95_ci: baselineCi,
      current_wilson_95_ci: currentCi,
      regressed,
    };

    if (regressed) {
      reasons.push(`${metric} regressed by ${Math.abs(delta).toFixed(4)} (tolerance ${Math.abs(tolerance).toFixed(4)})`);
    }
  }

  return {
    baseline_receipt_id: baseline.receipt_id,
    current_receipt_id: current.receipt_id,
    tolerance: defaultScoreTolerance,
    dimension_tolerances: Object.fromEntries([...dimensions].map((dimension) => [
      dimension,
      Math.abs(config.dimensionTolerances?.[dimension] ?? defaultScoreTolerance),
    ])),
    regressed: reasons.length > 0,
    reasons,
    score_delta: roundDelta(scoreDelta),
    dimension_comparisons: dimensionComparisons,
    cost_regression: costRegression,
    latency_regression: latencyRegression,
    metric_comparisons: metricComparisons,
  };
}

function signReceiptPayload(receipt: ExecutionReceipt, hmacSecret: string): string {
  return crypto
    .createHmac('sha256', hmacSecret)
    .update(stableStringify(stripSignatureMetadata(receipt)))
    .digest('hex');
}

function stripSignatureMetadata(receipt: ExecutionReceipt): ExecutionReceipt {
  const metadata = { ...(receipt.metadata ?? {}) };
  for (const key of SIGNATURE_FIELDS) {
    delete metadata[key];
  }
  return {
    ...receipt,
    metadata,
  };
}

function migrateReceiptFrom0To1(raw: any, migratedAt: string): any {
  return {
    ...raw,
    schema_version: 1,
    metadata: {
      ...(raw.metadata ?? {}),
      schema_history: [
        ...schemaHistory(raw),
        {
          from: 0,
          to: 1,
          migrated_at: migratedAt,
        },
      ],
    },
  };
}

function migrateReceiptFrom1To2(raw: any, migratedAt: string): any {
  const metadata = { ...(raw.metadata ?? {}) };
  const legacySignature = metadata.receipt_signature;
  for (const key of SIGNATURE_FIELDS) {
    delete metadata[key];
  }

  return {
    ...raw,
    schema_version: 2,
    metadata: {
      ...metadata,
      ...(legacySignature ? { legacy_receipt_signature: legacySignature } : {}),
      api_stability: metadata.api_stability ?? API_STABILITY.receipts.level,
      rubric_version: metadata.rubric_version ?? raw.rubric_name,
      schema_history: [
        ...schemaHistory(raw),
        {
          from: 1,
          to: 2,
          migrated_at: migratedAt,
        },
      ],
    },
  };
}

function schemaHistory(raw: any): Array<Record<string, unknown>> {
  return Array.isArray(raw.metadata?.schema_history)
    ? raw.metadata.schema_history
    : raw.metadata?.schema_migration
      ? [raw.metadata.schema_migration]
      : [];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function markExpiration(receipt: ExecutionReceipt): ExecutionReceipt {
  const expiresAt = receipt.metadata?.receipt_expires_at;
  if (!expiresAt) return receipt;
  return {
    ...receipt,
    metadata: {
      ...receipt.metadata,
      receipt_expired: new Date(expiresAt).getTime() < Date.now(),
    },
  };
}

function verdictRank(verdict: string): number {
  const ranks: Record<string, number> = {
    fail: 0,
    risky: 1,
    pass_with_warnings: 2,
    pass: 3,
  };
  return ranks[verdict] ?? 0;
}

function wilsonInterval(successes: number, total: number): { lower: number; upper: number } {
  if (total <= 0) {
    return { lower: 0, upper: 0 };
  }
  const boundedSuccesses = Math.max(0, Math.min(total, successes));
  const z = 1.96;
  const phat = boundedSuccesses / total;
  const denominator = 1 + (z * z) / total;
  const center = phat + (z * z) / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return {
    lower: Math.max(0, Math.min(1, (center - margin) / denominator)),
    upper: Math.max(0, Math.min(1, (center + margin) / denominator)),
  };
}

function numericMetadata(receipt: ExecutionReceipt, key: string): number | null {
  const value = receipt.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function inferComparisonSampleSize(current: ExecutionReceipt, baseline: ExecutionReceipt): number {
  const candidates = [
    numericMetadata(current, 'sample_size'),
    numericMetadata(baseline, 'sample_size'),
    Array.isArray(current.metadata?.consensus?.votes) ? current.metadata.consensus.votes.length : null,
    Array.isArray(baseline.metadata?.consensus?.votes) ? baseline.metadata.consensus.votes.length : null,
    30,
  ];
  return Math.max(1, Math.round(candidates.find((value) => typeof value === 'number' && value > 0) ?? 30));
}

function roundDelta(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// Helper: Get ISO week number
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
