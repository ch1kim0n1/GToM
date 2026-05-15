import { sanitizeIdentifier, sanitizeJsonValue, sanitizeUrl, sanitizeUserString } from '../src/core/input-sanitizer';
import { authenticityToLevel, getRubricHash, GTOM_RUBRIC_V1, levelToAuthenticity } from '../src/core/gtom-rubric';

describe('mutation coverage targets', () => {
  it('keeps authenticity rubric conversions bounded and reversible', () => {
    expect(authenticityToLevel(0)).toBe(1);
    expect(authenticityToLevel(0.5)).toBe(3);
    expect(authenticityToLevel(1)).toBe(5);
    expect(levelToAuthenticity(1)).toBe(0);
    expect(levelToAuthenticity(5)).toBe(1);
    expect(getRubricHash(GTOM_RUBRIC_V1)).toMatch(/^[a-f0-9]{8}$/);
  });

  it('rejects malformed user-controlled strings', () => {
    expect(sanitizeUserString('  ok  ', { fieldName: 'value' })).toBe('ok');
    expect(sanitizeUserString('  ok  ', { fieldName: 'value', trim: false })).toBe('  ok  ');
    expect(() => sanitizeUserString('', { fieldName: 'value' })).toThrow('must not be empty');
    expect(() => sanitizeUserString('abcdef', { fieldName: 'value', maxLength: 3 })).toThrow('maximum length');
    expect(() => sanitizeUserString('bad\u0001value', { fieldName: 'value' })).toThrow('control characters');
    expect(() => sanitizeUserString('bad\nvalue', { fieldName: 'value', allowNewlines: false })).toThrow('control characters');
  });

  it('sanitizes identifiers, URLs, and nested JSON payloads', () => {
    expect(sanitizeIdentifier('agent_1:run-2.trace', 'id')).toBe('agent_1:run-2.trace');
    expect(() => sanitizeIdentifier('agent id', 'id')).toThrow('may only contain');
    expect(sanitizeUrl('https://example.com/path/', 'callback')).toBe('https://example.com/path');
    expect(() => sanitizeUrl('file:///tmp/secret', 'callback')).toThrow('must use http or https');

    const payload = sanitizeJsonValue({
      actor: 'user',
      items: ['safe', 1, true, null],
    });
    expect(payload).toEqual({
      actor: 'user',
      items: ['safe', 1, true, null],
    });
    expect(() => sanitizeJsonValue({ 'bad key': 'value' })).toThrow('may only contain');
  });
});
