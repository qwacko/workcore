import type { Json } from './definitions.js';

export class WorkcoreError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

/** Reject lossy JSON representations, including Date, undefined and non-finite numbers. */
export function encode(value: unknown, maxBytes = 524_288): string {
  const ancestors = new Set<object>();
  function visit(item: unknown): void {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || item === null || ancestors.has(item)) throw new WorkcoreError('INVALID_JSON', 'Expected acyclic JSON data');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new WorkcoreError('INVALID_JSON', 'Only plain JSON objects are supported');
    }
    if (Object.getOwnPropertySymbols(item).length || (Array.isArray(item) && Object.keys(item).length !== item.length)) {
      throw new WorkcoreError('INVALID_JSON', 'Symbols and sparse or extended arrays are not supported');
    }
    ancestors.add(item);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue;
      if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new WorkcoreError('INVALID_JSON', 'Only enumerable data properties are supported');
      visit(descriptor.value);
    }
    ancestors.delete(item);
  }
  visit(value);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > maxBytes) throw new WorkcoreError('TOO_LARGE', `JSON payload exceeds ${maxBytes} bytes`, 413);
  return encoded;
}

export function json(value: unknown): Json { return JSON.parse(encode(value)) as Json; }
export function assertSync(value: unknown): void {
  if (value && typeof (value as { then?: unknown }).then === 'function') throw new WorkcoreError('ASYNC_TRANSACTION', 'Reads, mutations and authorization must be synchronous');
}
export function checkName(name: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) throw new WorkcoreError('INVALID_NAME', `Invalid name: ${name}`);
}
