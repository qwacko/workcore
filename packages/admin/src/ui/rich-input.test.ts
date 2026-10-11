import { describe, expect, it } from 'vitest';
import { editableJson, parseEditableJson, hydrateRuntimeTypes } from './rich-input.js';

describe('rich admin input', () => {
  it('keeps ordinary JSON editable without an envelope', () => {
    const input = { title: 'Hello', count: 2, enabled: true };
    expect(editableJson(input)).toBe(JSON.stringify(input, null, 2));
    expect(parseEditableJson(editableJson(input))).toEqual(input);
  });

  it('preserves regexp, non-finite numbers and other supported rich values', () => {
    const input = { regexp: /test/gi, infinity: Infinity, nan: NaN, negative: -Infinity, date: new Date(), count: 12n, missing: undefined, map: new Map([['x', 1]]), set: new Set([2]) };
    expect(editableJson(input)).toContain('$workcoreEditor');
    expect(parseEditableJson(editableJson(input))).toEqual(input);
  });

  it('preserves cycles and shared references through editing and hydration', () => {
    const shared = { at: '2026-10-12T10:30:00.000Z' };
    const input: Record<string, unknown> = { shared, alias: shared, array: [shared], map: new Map(), set: new Set() };
    input.self = input;
    (input.map as Map<unknown, unknown>).set(input, shared);
    (input.set as Set<unknown>).add(input);
    const decoded = parseEditableJson(editableJson(input));
    const result = hydrateRuntimeTypes(decoded, { properties: { shared: { properties: { at: { 'x-workcore-runtimeType': 'date' } } } } }) as typeof input;
    expect(result.self).toBe(result);
    expect(result.alias).toBe(result.shared);
    expect((result.array as unknown[])[0]).toBe(result.shared);
    expect((result.map as Map<unknown, unknown>).get(result)).toBe(result.shared);
    expect((result.set as Set<unknown>).has(result)).toBe(true);
    expect((result.shared as { at: unknown }).at).toBeInstanceOf(Date);
    expect(shared.at).toBe('2026-10-12T10:30:00.000Z');
  });

  it('hydrates only explicitly annotated dates', () => {
    const value = '2026-10-12T10:30:00.000Z';
    expect(hydrateRuntimeTypes(value, { type: 'string', format: 'date-time' })).toBe(value);
    expect(hydrateRuntimeTypes(value, { 'x-workcore-runtimeType': 'date' })).toEqual(new Date(value));
  });
});
