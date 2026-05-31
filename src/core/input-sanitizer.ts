export interface SanitizeStringOptions {
  fieldName: string;
  maxLength?: number;
  allowNewlines?: boolean;
  trim?: boolean;
}

const DEFAULT_MAX_LENGTH = 10_000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const CONTROL_CHARS_WITH_NEWLINES = /[\u0000-\u001F\u007F]/;

export function sanitizeUserString(value: unknown, options: SanitizeStringOptions): string {
  if (typeof value !== 'string') {
    throw new Error(`${options.fieldName} must be a string`);
  }
  const sanitized = options.trim === false ? value : value.trim();
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (sanitized.length === 0) {
    throw new Error(`${options.fieldName} must not be empty`);
  }
  if (sanitized.length > maxLength) {
    throw new Error(`${options.fieldName} exceeds maximum length of ${maxLength} characters`);
  }
  const pattern = options.allowNewlines === false ? CONTROL_CHARS_WITH_NEWLINES : CONTROL_CHARS;
  if (pattern.test(sanitized)) {
    throw new Error(`${options.fieldName} contains control characters`);
  }
  return sanitized;
}

export function sanitizeIdentifier(value: unknown, fieldName: string, maxLength = 128): string {
  const identifier = sanitizeUserString(value, {
    fieldName,
    maxLength,
    allowNewlines: false,
  });
  if (!/^[A-Za-z0-9_.:-]+$/.test(identifier)) {
    throw new Error(`${fieldName} may only contain letters, numbers, _, ., :, and -`);
  }
  return identifier;
}

export function sanitizeUrl(value: unknown, fieldName: string): string {
  const url = sanitizeUserString(value, {
    fieldName,
    maxLength: 2_048,
    allowNewlines: false,
  });
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${fieldName} must use http or https`);
  }
  // SSRF guard: block private / loopback / link-local / metadata hosts unless
  // the operator has explicitly opted in for local development.
  if (process.env.GTOM_ALLOW_PRIVATE_ENDPOINTS !== 'true' && isBlockedHost(parsed.hostname)) {
    throw new Error(
      `${fieldName} resolves to a private, loopback, link-local, or metadata host, which is blocked. ` +
        `Set GTOM_ALLOW_PRIVATE_ENDPOINTS=true to allow this in local development.`,
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

/**
 * Returns true for hostnames/IPs that point at the local machine or an internal
 * network and therefore must not be reachable via server-side fetch (SSRF).
 * Covers RFC1918, loopback, link-local (incl. cloud metadata 169.254.169.254),
 * IPv6 loopback/ULA/link-local, and `*.local` / `localhost`.
 */
export function isBlockedHost(hostname: string): boolean {
  // URL hostname keeps IPv6 brackets; strip them.
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }

  // IPv4
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1, 5).map(Number);
    if (octets.some((o) => o > 255)) return true; // malformed → block
    const [a, b] = octets;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 0) return true; // 0.0.0.0/8
    if (a >= 224) return true; // multicast / reserved
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    return false;
  }

  // IPv6
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true; // loopback / unspecified
    if (host.startsWith('fe80')) return true; // link-local
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique local fc00::/7
    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
    const mapped = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isBlockedHost(mapped[1]);
    return false;
  }

  return false;
}

export function sanitizePath(value: unknown, fieldName: string): string {
  const filePath = sanitizeUserString(value, {
    fieldName,
    maxLength: 4_096,
    allowNewlines: false,
    trim: false,
  });
  if (filePath.includes('\0')) {
    throw new Error(`${fieldName} contains invalid path characters`);
  }
  return filePath;
}

export function sanitizeJsonValue<T>(value: T, fieldName = 'request', maxStringLength = DEFAULT_MAX_LENGTH): T {
  return sanitizeValue(value, fieldName, maxStringLength, 0) as T;
}

function sanitizeValue(value: unknown, fieldName: string, maxStringLength: number, depth: number): unknown {
  if (depth > 20) {
    throw new Error(`${fieldName} is too deeply nested`);
  }
  if (typeof value === 'string') {
    return sanitizeUserString(value, {
      fieldName,
      maxLength: maxStringLength,
      allowNewlines: true,
      trim: false,
    });
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) {
      throw new Error(`${fieldName} has too many items`);
    }
    return value.map((item, index) => sanitizeValue(item, `${fieldName}[${index}]`, maxStringLength, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = sanitizeIdentifier(key, `${fieldName} key`, 256);
      result[safeKey] = sanitizeValue(child, `${fieldName}.${safeKey}`, maxStringLength, depth + 1);
    }
    return result;
  }
  return value;
}
