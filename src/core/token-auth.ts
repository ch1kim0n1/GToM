import { createHmac } from 'node:crypto';

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

export function createAuthMiddleware(config: TokenAuthConfig): { authenticate: (authorization: string) => AuthResult } {
  return {
    authenticate(authorization: string): AuthResult {
      const token = authorization.replace(/^Bearer\s+/i, '').trim();
      if (!token) {
        return { success: false, error: 'empty bearer token' };
      }
      const [payloadPart, signature] = token.split('.');
      if (payloadPart && signature) {
        const expected = createHmac('sha256', config.secret).update(payloadPart).digest('hex');
        if (signature !== expected) {
          return { success: false, error: 'invalid token signature' };
        }
        try {
          const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
          return {
            success: true,
            token: {
              userId: payload.userId ?? payload.user_id,
              sub: payload.sub,
              roles: Array.isArray(payload.roles) ? payload.roles : config.defaultRoles,
            },
          };
        } catch {
          return { success: false, error: 'invalid token payload' };
        }
      }
      return {
        success: true,
        token: {
          sub: `${config.tool}-token`,
          roles: config.defaultRoles ?? ['read'],
        },
      };
    },
  };
}
