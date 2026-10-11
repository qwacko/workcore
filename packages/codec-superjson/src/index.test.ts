import { describe, expect, it } from 'vitest';
import { superjsonCodec } from './index.js';

describe('SuperJSON wire codec', () => {
  it('round-trips rich values, undefined and cycles through JSON-safe payloads', () => {
    const codec = superjsonCodec();
    const date = new Date('2026-10-12T10:00:00.000Z');
    const value: { date: Date; count: bigint; lookup: Map<string, Set<number>>; optional: undefined; self?: unknown } = {
      date, count: 12n, lookup: new Map([['values', new Set([1, 2])]]), optional: undefined,
    };
    value.self = value;
    const encoded = codec.encode(value);
    expect(() => JSON.stringify(encoded)).not.toThrow();
    const decoded = codec.decode(JSON.parse(JSON.stringify(encoded)));
    expect(decoded).toEqual(value);
    expect((decoded as typeof value).date).toBeInstanceOf(Date);
  });

  it('rejects functions and symbols instead of silently dropping them', () => {
    const codec = superjsonCodec();
    expect(() => codec.encode({ fn: () => 1 })).toThrow(/cannot contain functions/);
    expect(() => codec.encode({ value: Symbol('secret') })).toThrow(/cannot contain symbols/);
    expect(() => codec.encode({ [Symbol('key')]: 'value' })).toThrow(/symbol-keyed properties/);
  });
});
