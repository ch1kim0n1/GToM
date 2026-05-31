import { createHash, timingSafeEqual } from 'node:crypto';
import { globalObservability } from './observability.js';

export type AccessScope = 'read' | 'write' | 'admin';
export type PermissionRole = 'viewer' | 'operator' | 'admin';

export interface AccessPrincipal {
  userId: string;
  roles: PermissionRole[];
  scopes: AccessScope[];
  tokenHash?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset_at: string;
}

interface RateWindow {
  minute_count: number;
  minute_start: number;
  hour_count: number;
  hour_start: number;
}

const RATE_HOUR_WINDOW_MS = 60 * 60 * 1000;

export class FixedWindowRateLimiter {
  private readonly usage = new Map<string, RateWindow>();
  private readonly maxEntries: number;

  constructor(
    private readonly requestsPerMinute: number,
    private readonly requestsPerHour: number,
    maxEntries = parseInt(process.env.GTOM_RATE_LIMIT_MAX_ENTRIES ?? '50000', 10),
  ) {
    this.maxEntries = Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : 50000;
  }

  /**
   * Drop windows whose hour bucket has fully elapsed (they would reset on next
   * access anyway, so the state is dead weight) and, if still over the cap,
   * evict the oldest entries first. This bounds memory regardless of how many
   * distinct identities (e.g. spoofed XFF / rotated tokens) are seen.
   */
  private evictStale(now: number): void {
    for (const [key, window] of this.usage) {
      if (now - window.hour_start >= RATE_HOUR_WINDOW_MS) {
        this.usage.delete(key);
      }
    }
    // Evict down to maxEntries-1 so that the about-to-be-inserted new entry
    // keeps the total at or below maxEntries.
    if (this.usage.size < this.maxEntries) return;
    // Map preserves insertion order; oldest-inserted keys come first.
    const overflow = this.usage.size - this.maxEntries + 1;
    let removed = 0;
    for (const key of this.usage.keys()) {
      if (removed >= overflow) break;
      this.usage.delete(key);
      removed++;
    }
  }

  /** Exposed for tests/monitoring. */
  size(): number {
    return this.usage.size;
  }

  check(identity: string, now = Date.now()): RateLimitResult {
    const minuteWindow = 60 * 1000;
    const hourWindow = RATE_HOUR_WINDOW_MS;
    const existing = this.usage.get(identity);
    if (!existing) {
      // Opportunistically sweep stale/overflow entries when a new identity
      // appears — this is the path an attacker hammers with rotating keys.
      this.evictStale(now);
    }
    const current = existing ?? {
      minute_count: 0,
      minute_start: now,
      hour_count: 0,
      hour_start: now,
    };

    if (now - current.minute_start >= minuteWindow) {
      current.minute_count = 0;
      current.minute_start = now;
    }
    if (now - current.hour_start >= hourWindow) {
      current.hour_count = 0;
      current.hour_start = now;
    }

    const minuteExceeded = current.minute_count >= this.requestsPerMinute;
    const hourExceeded = current.hour_count >= this.requestsPerHour;
    if (minuteExceeded || hourExceeded) {
      const resetAt = hourExceeded ? current.hour_start + hourWindow : current.minute_start + minuteWindow;
      return {
        allowed: false,
        remaining: 0,
        reset_at: new Date(resetAt).toISOString(),
      };
    }

    current.minute_count++;
    current.hour_count++;
    this.usage.set(identity, current);
    return {
      allowed: true,
      remaining: Math.min(this.requestsPerMinute - current.minute_count, this.requestsPerHour - current.hour_count),
      reset_at: new Date(current.minute_start + minuteWindow).toISOString(),
    };
  }
}

export function hashToken(token: string): string {
  // 32 hex chars = 128 bits: collision-resistant enough for identity / audit /
  // rate-limit keys across realistic token populations.
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

export function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function scopesForRoles(roles: string[]): AccessScope[] {
  const scopes = new Set<AccessScope>();
  for (const role of roles) {
    if (role === 'admin') {
      scopes.add('read');
      scopes.add('write');
      scopes.add('admin');
    } else if (role === 'operator' || role === 'write') {
      scopes.add('read');
      scopes.add('write');
    } else if (role === 'viewer' || role === 'read') {
      scopes.add('read');
    }
  }
  return Array.from(scopes);
}

export function hasRequiredScopes(granted: AccessScope[], required: AccessScope[]): boolean {
  if (granted.includes('admin')) return true;
  return required.every((scope) => {
    if (scope === 'read') return granted.includes('read') || granted.includes('write');
    return granted.includes(scope);
  });
}

export class PermissionManager {
  private readonly users = new Map<string, AccessPrincipal>();

  constructor(users: AccessPrincipal[] = parseUsers(process.env.GTOM_USERS)) {
    for (const user of users) {
      this.users.set(user.userId, {
        ...user,
        scopes: user.scopes.length > 0 ? user.scopes : scopesForRoles(user.roles),
      });
    }
  }

  getPrincipal(userId: string, fallbackScopes: AccessScope[] = ['read']): AccessPrincipal {
    return this.users.get(userId) ?? {
      userId,
      roles: fallbackScopes.includes('admin') ? ['admin'] : fallbackScopes.includes('write') ? ['operator'] : ['viewer'],
      scopes: fallbackScopes,
    };
  }

  authorize(principal: AccessPrincipal, requiredScopes: AccessScope[], resource: string): boolean {
    const allowed = hasRequiredScopes(principal.scopes, requiredScopes);
    if (!allowed) {
      globalObservability.audit.recordSecurityEvent({
        event_type: 'authorization_denied',
        actor: principal.userId,
        resource,
        scopes: principal.scopes,
        required_scopes: requiredScopes,
        metadata: { token_hash: principal.tokenHash },
      });
    }
    return allowed;
  }
}

function parseUsers(raw?: string): AccessPrincipal[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ userId?: string; user_id?: string; roles?: string[]; scopes?: string[] }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((user) => {
        const userId = user.userId ?? user.user_id;
        if (!userId) return null;
        const roles = (user.roles ?? ['viewer']).filter((role): role is PermissionRole =>
          ['viewer', 'operator', 'admin'].includes(role),
        );
        const scopes = (user.scopes ?? scopesForRoles(roles)).filter((scope): scope is AccessScope =>
          ['read', 'write', 'admin'].includes(scope),
        );
        return { userId, roles, scopes };
      })
      .filter((user): user is AccessPrincipal => Boolean(user));
  } catch (error) {
    globalObservability.logger.warn('Failed to parse GTOM_USERS permissions config', { error });
    return [];
  }
}
