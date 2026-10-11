import SuperJSON, { type SuperJSONValue } from 'superjson';
import type { JsonValue, WireCodec } from '@workcore/core';

export type SuperJsonCodecOptions = {
  /** Override only when the custom SuperJSON registrations are versioned and shared by all peers. */
  id?: string;
  configure?: (serializer: SuperJSON) => void;
};

/** Optional SuperJSON wire codec. Custom classes require matching registrations on every peer. */
export function superjsonCodec(options?: Omit<SuperJsonCodecOptions, 'id'>): WireCodec & { id: 'superjson-v1' };
export function superjsonCodec(options: SuperJsonCodecOptions & { id: string }): WireCodec;
export function superjsonCodec(options: SuperJsonCodecOptions = {}): WireCodec {
  const serializer = new SuperJSON();
  options.configure?.(serializer);
  return {
    id: options.id ?? 'superjson-v1',
    encode(value) {
      assertSupportedValues(value);
      return { serialized: serializer.stringify(value as SuperJSONValue) };
    },
    decode(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { serialized?: unknown }).serialized !== 'string') {
        throw new TypeError('Invalid SuperJSON wire payload');
      }
      return serializer.parse((value as { serialized: string }).serialized);
    },
  } satisfies WireCodec;
}

function assertSupportedValues(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === 'function') throw new TypeError('SuperJSON wire values cannot contain functions');
  if (typeof value === 'symbol') throw new TypeError('SuperJSON wire values cannot contain symbols');
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof RegExp || value instanceof URL || value instanceof URLSearchParams) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, item] of value) { assertSupportedValues(key, seen); assertSupportedValues(item, seen); }
    return;
  }
  if (value instanceof Set) {
    for (const item of value) assertSupportedValues(item, seen);
    return;
  }
  if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) {
    throw new TypeError(`SuperJSON wire values do not support ${value.constructor.name}`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw new TypeError('SuperJSON wire values cannot contain symbol-keyed properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    if (!('value' in descriptor)) throw new TypeError('SuperJSON wire values cannot contain accessor properties');
    assertSupportedValues(descriptor.value, seen);
  }
}

export type { JsonValue };
