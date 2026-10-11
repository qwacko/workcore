import { parse, stringify } from 'devalue';
import type { WireCodec } from '@workcore/core';

/** Optional devalue codec for its supported built-in values. Custom values need explicit reducers/revivers. */
export function devalueCodec(options: { id?: string } = {}): WireCodec {
  return {
    id: options.id ?? 'devalue-v1',
    encode(value) { return { serialized: stringify(value) }; },
    decode(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { serialized?: unknown }).serialized !== 'string') {
        throw new TypeError('Invalid devalue wire payload');
      }
      return parse((value as { serialized: string }).serialized);
    },
  };
}
