import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TokenAuthConfig {
  secret: string;
  tool: string;
  defaultRoles?: string[];
}

export interface AuthResult {
  success: boolean;
  error?: string;
  token?: {
    userId?: string;
    sub?: string;
    roles?: string[];
  };
}

/**
 * Constant-time comparison of two hex-encoded signatures. Returns false (rather
 * than throwing) when lengths differ so callers can treat it as a plain
 * mismatch without leaking timing information about where the difference is.
 */
function safeHexEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createAuthMiddleware(config: TokenAuthConfig): { authenticate: (authorization: string) => AuthResult } {
  return {
    authenticate(authorization: string): AuthResult {
      const token = authorization.replace(/^Bearer\s+/i, '').trim();
      if (!token) {
        return { success: false, error: 'empty bearer token' };
      }

      // Every token MUST be a signed `<payload>.<signature>` pair. There is no
      // opaque-token fallback: an unsigned/opaque bearer string is rejected.
      const parts = token.split('.');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return { success: false, error: 'unsigned or malformed token' };
      }
      const [payloadPart, signature] = parts;

      const expected = createHmac('sha256', config.secret).update(payloadPart).digest('hex');
      if (!safeHexEquals(signature, expected)) {
        return { success: false, error: 'invalid token signature' };
      }

      let payload: { userId?: string; user_id?: string; sub?: string; roles?: unknown; exp?: unknown };
      try {
        payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      } catch {
        return { success: false, error: 'invalid token payload' };
      }

      // Require and validate an expiry (seconds since epoch). Tokens with no
      // `exp`, a non-numeric `exp`, or an `exp` in the past are rejected.
      const exp = typeof payload.exp === 'number' ? payload.exp : Number(payload.exp);
      if (!Number.isFinite(exp)) {
        return { success: false, error: 'token missing or invalid exp claim' };
      }
      if (exp * 1000 <= Date.now()) {
        return { success: false, error: 'token expired' };
      }

      return {
        success: true,
        token: {
          userId: payload.userId ?? payload.user_id,
          sub: payload.sub,
          roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : config.defaultRoles,
        },
      };
    },
  };
}
