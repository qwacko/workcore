/** Resolve only own data fields, never prototype members or malformed array indices. */
export function fieldPath(value: unknown, path: string): unknown {
  const parts = path.split('.');
  if (parts.some((part) => !part || part === '__proto__' || part === 'prototype' || part === 'constructor')) return undefined;
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current) && !/^(0|[1-9]\d*)$/.test(part)) return undefined;
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
