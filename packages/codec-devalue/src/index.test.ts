import { describe, expect, it } from 'vitest';
import { devalueCodec } from './index.js';

describe('devalue wire codec', () => {
  it('round-trips dates, bigint, maps, sets, undefined and cycles', () => {
    const codec = devalueCodec();
    const value: { date: Date; count: bigint; lookup: Map<string, Set<number>>; optional: undefined; self?: unknown } = {
      date: new Date('2026-10-12T10:00:00.000Z'), count: 12n, lookup: new Map([['values', new Set([1, 2])]]), optional: undefined,
    };
    value.self = value;
    const decoded = codec.decode(JSON.parse(JSON.stringify(codec.encode(value))));
    expect(decoded).toEqual(value);
    expect((decoded as typeof value).date).toBeInstanceOf(Date);
  });
});
