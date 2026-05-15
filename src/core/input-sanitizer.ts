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
  return parsed.toString().replace(/\/$/, '');
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
