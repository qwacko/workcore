import { Validator, type Schema } from '@cfworker/json-schema';
import type { Json, JsonSchema, Manifest, ManifestAction } from '@workcore/core';

export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function readPath(value: unknown, path = ''): any {
  if (!path) return value;
  let current = value as any;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part) || ['__proto__', 'prototype', 'constructor'].includes(part)) return undefined;
    current = current[part];
  }
  return current;
}
export function setField(value: unknown, name: string, next: unknown): Record<string, Json> {
  const result = { ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}) } as Record<string, Json>;
  if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid field name');
  if (next === undefined) delete result[name]; else result[name] = next as Json;
  return result;
}
export function resolveSchema(schema: JsonSchema, root: JsonSchema = schema): JsonSchema {
  if (schema.$ref?.startsWith('#/')) return resolveSchema(readPath(root, schema.$ref.slice(2).replaceAll('/', '.')) ?? {}, root);
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants?.length === 2 && variants.some(part => part.type === 'null')) return variants.find(part => part.type !== 'null')!;
  return schema;
}
export function defaults(schema: JsonSchema): Json {
  if (schema.default !== undefined) return clone(schema.default);
  const resolved = resolveSchema(schema);
  if (resolved.type === 'object' || resolved.properties) {
    return Object.fromEntries(Object.entries(resolved.properties ?? {}).filter(([key, child]) => child.default !== undefined || resolved.required?.includes(key)).map(([key, child]) => [key, defaults(child)]));
  }
  if (resolved.enum?.length) return resolved.enum[0]!;
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.type === 'array') return [];
  if (resolved.type === 'boolean') return false;
  if (resolved.type === 'null') return null;
  if (resolved.type === 'number' || resolved.type === 'integer') return resolved.minimum ?? 0;
  return '';
}
export function validation(schema: JsonSchema, value: unknown): Record<string, string> {
  const validated = new Validator(schema as Schema, '2020-12', false).validate(value);
  if (validated.valid) return {};
  const result: Record<string, string> = {};
  for (const error of validated.errors) {
    const path = error.instanceLocation.replace(/^#?\//, '').replaceAll('/', '.');
    result[path] = error.error;
  }
  return result;
}
export function label(name: string): string { return name.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase()); }
export function text(value: unknown): string { return value === undefined || value === null ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
export function date(value: unknown): string { return typeof value === 'number' || typeof value === 'string' ? new Date(value).toLocaleString() : '—'; }
export function duration(start: unknown, end: unknown): string {
  if (typeof start !== 'number' || typeof end !== 'number') return '—';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function operationFor(manifest: Manifest, action: ManifestAction) { return manifest[action.operation.kind][action.operation.name]; }
export function actionValues(action: ManifestAction, row: unknown, schema: JsonSchema) {
  let initial = defaults(schema);
  for (const [key, path] of Object.entries(action.initial ?? {})) {
    const value = readPath(row, path); if (value !== undefined) initial = setField(initial, key, value);
  }
  for (const [key, path] of Object.entries(action.bind ?? {})) {
    const value = readPath(row, path); if (value !== undefined) initial = setField(initial, key, value);
  }
  return { ...(initial as object), ...action.values } as Json;
}
export function condition(condition: ManifestAction['visibleWhen'], row: unknown, actorId: string): boolean {
  if (!condition) return true;
  const expected = condition.equals && typeof condition.equals === 'object' && !Array.isArray(condition.equals) && condition.equals.actor === true ? actorId : condition.equals;
  return JSON.stringify(readPath(row, condition.path)) === JSON.stringify(expected);
}
export function rowSchema(schema: JsonSchema): JsonSchema {
  const resolved = resolveSchema(schema);
  return resolved.items ?? resolved.properties?.rows?.items ?? resolved;
}
export function schemaAt(schema: JsonSchema, path: string): JsonSchema {
  let result = schema;
  for (const part of path.split('.')) result = resolveSchema(result).properties?.[part] ?? {};
  return result;
}
