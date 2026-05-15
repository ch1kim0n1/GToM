import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { globalObservability } from './observability.js';

export interface BudgetReservation {
  id: string;
  operation: string;
  scope: string;
  resolver: string;
  reserved_usd: number;
  committed_usd: number;
  created_at: string;
  expires_at: string;
  status: 'reserved' | 'committed' | 'expired' | 'released';
  metadata?: Record<string, unknown>;
}

export interface SpendEntry {
  timestamp: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  operation: string;
  resolver: string;
  scope: string;
  reservation_id?: string;
}

export interface BudgetLedgerConfig {
  maxBudgetUsd: number;
  defaultTtlMs?: number;
  alertThresholdUsd?: number;
  resolverCapsUsd?: Record<string, number>;
  scopeCapsUsd?: Record<string, number>;
  baseDir?: string;
  now?: () => Date;
}

export class BudgetLedger {
  private readonly config: Required<Omit<BudgetLedgerConfig, 'baseDir' | 'resolverCapsUsd' | 'scopeCapsUsd'>>;
  private readonly resolverCapsUsd: Record<string, number>;
  private readonly scopeCapsUsd: Record<string, number>;
  private readonly auditDir: string;
  private readonly reservations = new Map<string, BudgetReservation>();
  private readonly spend: SpendEntry[] = [];

  constructor(config: BudgetLedgerConfig, toolName = 'gtom') {
    this.config = {
      maxBudgetUsd: config.maxBudgetUsd,
      defaultTtlMs: config.defaultTtlMs ?? 30 * 60 * 1000,
      alertThresholdUsd: config.alertThresholdUsd ?? config.maxBudgetUsd * 0.8,
      now: config.now ?? (() => new Date()),
    };
    this.resolverCapsUsd = config.resolverCapsUsd ?? {};
    this.scopeCapsUsd = config.scopeCapsUsd ?? {};
    const baseDir = config.baseDir ?? os.homedir();
    this.auditDir = path.join(baseDir, `.${toolName}`, 'audit');
    this.loadSpend();
  }

  reserve(
    operation: string,
    amountUsd: number,
    options: {
      ttlMs?: number;
      resolver?: string;
      scope?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): BudgetReservation {
    this.cleanupExpired();
    this.assertFiniteCost(amountUsd);

    const resolver = options.resolver ?? 'default';
    const scope = options.scope ?? 'default';
    const now = this.config.now();
    const projectedTotal = this.getTotalSpendUsd() + this.getReservedUsd() + amountUsd;
    if (projectedTotal > this.config.maxBudgetUsd) {
      throw new Error(
        `Budget cap exceeded: projected $${projectedTotal.toFixed(6)} exceeds max $${this.config.maxBudgetUsd.toFixed(6)}`,
      );
    }
    this.assertCap('resolver', resolver, this.getSpendByResolver()[resolver] ?? 0, amountUsd, this.resolverCapsUsd);
    this.assertCap('scope', scope, this.getSpendByScope()[scope] ?? 0, amountUsd, this.scopeCapsUsd);

    const reservation: BudgetReservation = {
      id: this.generateId(),
      operation,
      resolver,
      scope,
      reserved_usd: amountUsd,
      committed_usd: 0,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + (options.ttlMs ?? this.config.defaultTtlMs)).toISOString(),
      status: 'reserved',
      metadata: options.metadata,
    };

    this.reservations.set(reservation.id, reservation);
    this.warnIfNeeded();
    return { ...reservation };
  }

  commit(
    reservationId: string,
    actualCostUsd: number,
    spend: Omit<SpendEntry, 'timestamp' | 'cost_usd' | 'reservation_id' | 'operation' | 'resolver' | 'scope'> & {
      operation?: string;
      resolver?: string;
      scope?: string;
    },
  ): BudgetReservation {
    this.cleanupExpired();
    this.assertFiniteCost(actualCostUsd);
    const reservation = this.requireActiveReservation(reservationId);
    this.assertCap(
      'resolver',
      reservation.resolver,
      this.getSpendByResolver()[reservation.resolver] ?? 0,
      actualCostUsd,
      this.resolverCapsUsd,
    );
    this.assertCap(
      'scope',
      reservation.scope,
      this.getSpendByScope()[reservation.scope] ?? 0,
      actualCostUsd,
      this.scopeCapsUsd,
    );

    reservation.status = 'committed';
    reservation.committed_usd = actualCostUsd;
    this.reservations.set(reservationId, reservation);
    this.recordSpend({
      timestamp: this.config.now().toISOString(),
      model_id: spend.model_id,
      input_tokens: spend.input_tokens,
      output_tokens: spend.output_tokens,
      cost_usd: actualCostUsd,
      operation: spend.operation ?? reservation.operation,
      resolver: spend.resolver ?? reservation.resolver,
      scope: spend.scope ?? reservation.scope,
      reservation_id: reservationId,
    });
    this.warnIfNeeded();
    return { ...reservation };
  }

  release(reservationId: string): BudgetReservation {
    const reservation = this.requireActiveReservation(reservationId);
    reservation.status = 'released';
    this.reservations.set(reservationId, reservation);
    return { ...reservation };
  }

  recordUnreservedSpend(entry: Omit<SpendEntry, 'timestamp'>): void {
    this.assertFiniteCost(entry.cost_usd);
    this.assertCap('resolver', entry.resolver, this.getSpendByResolver()[entry.resolver] ?? 0, entry.cost_usd, this.resolverCapsUsd);
    this.assertCap('scope', entry.scope, this.getSpendByScope()[entry.scope] ?? 0, entry.cost_usd, this.scopeCapsUsd);
    this.recordSpend({
      ...entry,
      timestamp: this.config.now().toISOString(),
    });
    this.warnIfNeeded();
  }

  cleanupExpired(): number {
    const now = this.config.now().getTime();
    let expired = 0;
    for (const [id, reservation] of this.reservations.entries()) {
      if (reservation.status === 'reserved' && new Date(reservation.expires_at).getTime() <= now) {
        reservation.status = 'expired';
        this.reservations.set(id, reservation);
        expired++;
      }
    }
    return expired;
  }

  getStatus() {
    this.cleanupExpired();
    const totalSpend = this.getTotalSpendUsd();
    const reserved = this.getReservedUsd();
    return {
      max_budget_usd: this.config.maxBudgetUsd,
      total_reserved_usd: reserved,
      total_committed_usd: totalSpend,
      remaining_budget_usd: this.config.maxBudgetUsd - totalSpend - reserved,
      utilization_rate: this.config.maxBudgetUsd === 0 ? 1 : (totalSpend + reserved) / this.config.maxBudgetUsd,
      active_reservations: this.getActiveReservations().length,
    };
  }

  getSummary() {
    return {
      status: this.getStatus(),
      daily_spend_usd: this.getDailySpend(),
      weekly_spend_usd: this.getWeeklySpend(),
      monthly_spend_usd: this.getMonthlySpend(),
      by_model: this.getSpendByModel(),
      by_operation: this.getSpendByOperation(),
      by_resolver: this.getSpendByResolver(),
      by_scope: this.getSpendByScope(),
    };
  }

  getAllReservations(): BudgetReservation[] {
    this.cleanupExpired();
    return Array.from(this.reservations.values()).map((reservation) => ({ ...reservation }));
  }

  getActiveReservations(): BudgetReservation[] {
    return this.getAllReservations().filter((reservation) => reservation.status === 'reserved');
  }

  getDailySpend(): number {
    return this.getSpendSince(1);
  }

  getWeeklySpend(): number {
    return this.getSpendSince(7);
  }

  getMonthlySpend(): number {
    return this.getSpendSince(30);
  }

  getTotalSpendUsd(): number {
    return this.spend.reduce((sum, entry) => sum + entry.cost_usd, 0);
  }

  getSpendByModel(): Record<string, number> {
    return this.groupSpendBy('model_id');
  }

  getSpendByOperation(): Record<string, number> {
    return this.groupSpendBy('operation');
  }

  getSpendByResolver(): Record<string, number> {
    return this.groupSpendBy('resolver');
  }

  getSpendByScope(): Record<string, number> {
    return this.groupSpendBy('scope');
  }

  private recordSpend(entry: SpendEntry): void {
    this.spend.push(entry);
    fs.mkdirSync(this.auditDir, { recursive: true });
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(path.join(this.auditDir, this.dailyFileName(entry.timestamp)), line, 'utf8');
    fs.appendFileSync(path.join(this.auditDir, this.weeklyFileName(entry.timestamp)), line, 'utf8');
  }

  private loadSpend(): void {
    if (!fs.existsSync(this.auditDir)) return;
    const seen = new Set<string>();
    for (const fileName of fs.readdirSync(this.auditDir)) {
      if (!/^cost-\d{4}-\d{2}-\d{2}\.jsonl$/.test(fileName)) continue;
      const fullPath = path.join(this.auditDir, fileName);
      const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line) as SpendEntry;
        const key = `${entry.timestamp}:${entry.model_id}:${entry.operation}:${entry.cost_usd}`;
        if (!seen.has(key)) {
          seen.add(key);
          this.spend.push(entry);
        }
      }
    }
  }

  private getSpendSince(days: number): number {
    const cutoff = this.config.now().getTime() - days * 24 * 60 * 60 * 1000;
    return this.spend
      .filter((entry) => new Date(entry.timestamp).getTime() >= cutoff)
      .reduce((sum, entry) => sum + entry.cost_usd, 0);
  }

  private getReservedUsd(): number {
    return Array.from(this.reservations.values())
      .filter((reservation) => reservation.status === 'reserved')
      .reduce((sum, reservation) => sum + reservation.reserved_usd, 0);
  }

  private groupSpendBy(field: 'model_id' | 'operation' | 'resolver' | 'scope'): Record<string, number> {
    const result: Record<string, number> = {};
    for (const entry of this.spend) {
      result[entry[field]] = (result[entry[field]] ?? 0) + entry.cost_usd;
    }
    return result;
  }

  private requireActiveReservation(reservationId: string): BudgetReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationId}`);
    }
    if (reservation.status !== 'reserved') {
      throw new Error(`Reservation is not active: ${reservation.status}`);
    }
    if (new Date(reservation.expires_at).getTime() <= this.config.now().getTime()) {
      reservation.status = 'expired';
      this.reservations.set(reservationId, reservation);
      throw new Error(`Reservation expired: ${reservationId}`);
    }
    return reservation;
  }

  private assertCap(
    capType: 'resolver' | 'scope',
    key: string,
    currentSpendUsd: number,
    additionalUsd: number,
    caps: Record<string, number>,
  ): void {
    const cap = caps[key] ?? caps['*'];
    if (cap === undefined) return;
    const projected = currentSpendUsd + additionalUsd;
    if (projected > cap) {
      throw new Error(`${capType} spend cap exceeded for ${key}: projected $${projected.toFixed(6)} exceeds $${cap.toFixed(6)}`);
    }
  }

  private assertFiniteCost(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      throw new Error(`Invalid cost amount: ${costUsd}`);
    }
  }

  private warnIfNeeded(): void {
    const total = this.getTotalSpendUsd() + this.getReservedUsd();
    if (total >= this.config.alertThresholdUsd) {
      globalObservability.logger.warn('Spend threshold exceeded', {
        total_usd: total,
        max_budget_usd: this.config.maxBudgetUsd,
      });
    }
  }

  private dailyFileName(timestamp: string): string {
    return `cost-${timestamp.slice(0, 10)}.jsonl`;
  }

  private weeklyFileName(timestamp: string): string {
    const date = new Date(timestamp);
    const week = this.isoWeek(date);
    return `cost-${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}.jsonl`;
  }

  private isoWeek(date: Date): number {
    const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    return Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  private generateId(): string {
    return `res_${this.config.now().getTime()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
