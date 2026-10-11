import SuperJSON from 'superjson';

const serializer = new SuperJSON();

function requiresEnvelope(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return false;
  if (typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value) || requiresEnvelope(value[index], seen)) return true;
    }
    return false;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return true;
  return Object.values(value).some((item) => requiresEnvelope(item, seen));
}

export function editableJson(value: unknown): string {
  if (!requiresEnvelope(value)) return JSON.stringify(value, null, 2);
  return JSON.stringify({ $workcoreEditor: 'superjson-v1', payload: serializer.serialize(value as never) }, null, 2);
}

export function parseEditableJson(text: string): unknown {
  const parsed = JSON.parse(text) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && (parsed as { $workcoreEditor?: unknown }).$workcoreEditor === 'superjson-v1' && 'payload' in parsed) {
    return serializer.deserialize((parsed as { payload: Parameters<SuperJSON['deserialize']>[0] }).payload);
  }
  return parsed;
}

/** Hydrate annotated dates while preserving the decoded graph's cycles and shared references. */
export function hydrateRuntimeTypes(value: unknown, schema: Record<string, unknown>, copies = new WeakMap<object, unknown>()): unknown {
  if (schema['x-workcore-runtimeType'] === 'date' && typeof value === 'string') return new Date(value);
  if (!value || typeof value !== 'object') return value;
  if (copies.has(value)) return copies.get(value);
  if (Array.isArray(value)) {
    const copy: unknown[] = new Array(value.length);
    copies.set(value, copy);
    const items = schema.items && typeof schema.items === 'object' ? schema.items as Record<string, unknown> : {};
    value.forEach((item, index) => { copy[index] = hydrateRuntimeTypes(item, items, copies); });
    return copy;
  }
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    copies.set(value, copy);
    for (const [key, item] of value) copy.set(hydrateRuntimeTypes(key, {}, copies), hydrateRuntimeTypes(item, {}, copies));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>();
    copies.set(value, copy);
    for (const item of value) copy.add(hydrateRuntimeTypes(item, {}, copies));
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const copy = Object.create(prototype) as Record<string, unknown>;
  copies.set(value, copy);
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(copy, key, { value: hydrateRuntimeTypes(item, properties?.[key] ?? {}, copies), enumerable: true, writable: true, configurable: true });
  }
  return copy;
}
