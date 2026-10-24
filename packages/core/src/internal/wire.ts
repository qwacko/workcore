import type { JsonValue, PlatformOptions, WireCodec } from '../index.js';
import { safeMessage, WorkcoreError } from './errors.js';

export const jsonWireCodec: WireCodec = {
  id: 'json',
  encode(value) { assertJsonValue(value); return value; },
  decode(value) { assertJsonValue(value); return value; },
};

function assertJsonValue(value: unknown, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new TypeError('JSON wire values cannot contain non-finite numbers');
  }
  if (typeof value !== 'object') throw new TypeError(`Unsupported JSON wire value: ${typeof value}`);
  if (seen.has(value)) throw new TypeError('JSON wire values cannot contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new TypeError('JSON wire arrays cannot be sparse');
      assertJsonValue(value[index], seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('JSON wire objects must be plain objects');
    for (const item of Object.values(value)) assertJsonValue(item, seen);
  }
  seen.delete(value);
}

export function encodeWithCodec(codec: WireCodec, value: unknown): JsonValue {
  try {
    const encoded = codec.encode(value);
    assertJsonValue(encoded);
    return encoded;
  } catch (error) {
    const detail = error instanceof TypeError ? error.message : safeMessage(error);
    throw new WorkcoreError('WIRE_ENCODING_FAILED', `Could not encode value with '${codec.id}': ${detail}`, 422);
  }
}

export function decodeWithCodec(codec: WireCodec, value: JsonValue): unknown {
  try { return codec.decode(value); }
  catch (error) {
    const detail = error instanceof TypeError ? error.message : safeMessage(error);
    throw new WorkcoreError('WIRE_DECODING_FAILED', `Could not decode value with '${codec.id}': ${detail}`, 400);
  }
}

export function resolveWireCodec(options: PlatformOptions, requestedId: string | null): WireCodec {
  if (!requestedId || requestedId === 'json') return jsonWireCodec;
  const codec = options.wireCodecs?.find((candidate) => candidate.id === requestedId);
  if (!codec) throw new WorkcoreError('WIRE_CODEC_UNSUPPORTED', `Wire codec '${requestedId}' is not supported`, 406);
  return codec;
}

export function decodeStored(value: JsonValue, codecId: string | undefined, options: PlatformOptions) {
  return decodeWithCodec(resolveWireCodec(options, codecId ?? 'json'), value);
}

export function encodeResult(codec: WireCodec, value: unknown, options: PlatformOptions): JsonValue {
  const encoded = encodeWithCodec(codec, value);
  if (new TextEncoder().encode(JSON.stringify(encoded)).byteLength > (options.maxResultBytes ?? 2_097_152)) throw new WorkcoreError('RESULT_TOO_LARGE', 'Operation result exceeds configured limit', 413);
  return encoded;
}
