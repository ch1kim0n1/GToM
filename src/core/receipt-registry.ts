import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { ExecutionReceipt } from '../types/quality-rubric.js';

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
  private basePath: string;
  private schemaPath: string;
  private week: string;  // ISO week YYYY-Www
  private readonly SCHEMA_VERSION = 1;

  constructor(projectName: string) {
    const now = new Date();
    const year = now.getFullYear();
    const weekNum = getISOWeek(now);
    this.week = `${year}-W${String(weekNum).padStart(2, '0')}`;
    const baseDir = path.join(process.cwd(), projectName, 'test', 'baselines');
    this.basePath = path.join(baseDir, `receipts-${this.week}.jsonl`);
    this.schemaPath = path.join(baseDir, `schema.json`);
    
    // Initialize persistence - fail loudly if cannot create directory
    this.initializePersistence();
  }

  private async initializePersistence(): Promise<void> {
    try {
      const dir = path.dirname(this.basePath);
      await fs.mkdir(dir, { recursive: true });
      
      // Initialize schema metadata
      await this.initializeSchema();
    } catch (error) {
      throw new Error(`Persistence initialization failed: ${error}. Persistence is REQUIRED for GToM.`);
    }
  }

  private async initializeSchema(): Promise<void> {
    try {
      const existingSchema = await this.readSchema();
      if (existingSchema && existingSchema.version !== this.SCHEMA_VERSION) {
        console.warn(`[ReceiptRegistry] Schema version mismatch: expected ${this.SCHEMA_VERSION}, got ${existingSchema.version}. Migration may be required.`);
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

  private async writeSchema(): Promise<void> {
    const schema = {
      version: this.SCHEMA_VERSION,
      created_at: new Date().toISOString(),
    };
    await fs.writeFile(this.schemaPath, JSON.stringify(schema, null, 2), 'utf8');
  }

  async append(receipt: ExecutionReceipt): Promise<void> {
    // Apply PII redaction before writing
    const redactedReceipt = redactPII(receipt);
    const line = JSON.stringify(redactedReceipt) + '\n';
    await fs.appendFile(this.basePath, line, 'utf8');
  }

  async getLatest(): Promise<ExecutionReceipt | null> {
    try {
      const content = await fs.readFile(this.basePath, 'utf8');
      const lines = content.trim().split('\n').filter((l: string) => l);
      if (lines.length === 0) return null;
      return JSON.parse(lines[lines.length - 1]) as ExecutionReceipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async getAllBetween(start: Date, end: Date): Promise<ExecutionReceipt[]> {
    const receipts: ExecutionReceipt[] = [];
    try {
      const content = await fs.readFile(this.basePath, 'utf8');
      const lines = content.trim().split('\n').filter((l: string) => l);
      for (const line of lines) {
        const receipt = JSON.parse(line) as ExecutionReceipt;
        const timestamp = new Date(receipt.timestamp);
        if (timestamp >= start && timestamp <= end) {
          receipts.push(receipt);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return receipts;
  }
}

// Helper: Get ISO week number
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
