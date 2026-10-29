import { getContext, setContext } from 'svelte';
import type { Json } from '@workcore/core';
import type { JsonSchema, ManifestDocument } from '@workcore/core';
import type { RendererHost } from './host-context.svelte.js';
import type { SuccessEffect } from '@workcore/core';
import { resetDisplayState } from './display-state.js';

export type DisplayAddress<T = Json> = string & { readonly __value?: T };
export type DisplayContext = {
  get<T extends Json = Json>(address: DisplayAddress<T> | string): T | undefined;
  set<T extends Json = Json>(address: DisplayAddress<T> | string, value: T | undefined): void | Promise<void>;
  update<T extends Json = Json>(address: DisplayAddress<T> | string, updater: (current: T | undefined) => T | undefined): void;
  configureState(definitions: NonNullable<ManifestDocument['state']>, namespace: string, host?: RendererHost): void;
  syncUrlState(): void;
  resetState(name: string): Promise<void>;
  registerEffectHandler(type: 'dialog.close', handler: () => void): () => void;
  dispatchEffect(effect: SuccessEffect): Promise<void>;
};

const displayContextKey = Symbol('workcore-display-context');

/** Create address-level Svelte state for one mounted display instance. */
export function createDisplayContext(): DisplayContext {
  let values = $state<Record<string, Json>>({});
  let stateDefinitions: NonNullable<ManifestDocument['state']> = {};
  let stateNamespace = 'display';
  let host: RendererHost | undefined;
  const effectHandlers = new Map<string, Set<() => void>>();
  const stateKey = (name: string) => `state.${name}`;
  const urlKey = (name: string) => `__state.${encodeURIComponent(stateNamespace)}.${encodeURIComponent(name)}`;
  const valid = (schema: JsonSchema, value: Json): boolean => {
    if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
    if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
    if (schema.anyOf && !schema.anyOf.some(item => valid(item, value))) return false;
    if (schema.type === 'string' && typeof value !== 'string' || schema.type === 'number' && typeof value !== 'number' || schema.type === 'integer' && (!Number.isInteger(value)) || schema.type === 'boolean' && typeof value !== 'boolean' || schema.type === 'null' && value !== null) return false;
    if (typeof value === 'string' && (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength)) return false;
    if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return false;
    return true;
  };
  function loadStateFromUrl(): void {
    const url = host?.location();
    if (!url) return;
    for (const [name, declaration] of Object.entries(stateDefinitions)) {
      if (declaration.persistence !== 'url') continue;
      const raw = url.searchParams.get(urlKey(name));
      if (raw === null) continue;
      try {
        const parsed = JSON.parse(raw) as Json;
        if (valid(declaration.schema, parsed)) values[stateKey(name)] = parsed;
        else values[stateKey(name)] = declaration.default;
      } catch { values[stateKey(name)] = declaration.default; }
    }
  }
  const context: DisplayContext = {
    get<T extends Json>(address: DisplayAddress<T> | string) { return values[address] as T | undefined; },
    set<T extends Json>(address: DisplayAddress<T> | string, value: T | undefined): void | Promise<void> {
      const name = address.startsWith('state.') ? address.slice('state.'.length) : undefined;
      const declaration = name ? stateDefinitions[name] : undefined;
      if (value !== undefined && declaration && !valid(declaration.schema, value)) throw new Error(`Invalid value for display state: ${name}`);
      if (value === undefined) delete values[address];
      else values[address] = value;
      if (name && declaration?.persistence === 'url' && host) {
        const url = new URL(host.location().href);
        if (value === undefined) url.searchParams.delete(urlKey(name)); else url.searchParams.set(urlKey(name), JSON.stringify(value));
        return Promise.resolve(host.navigate(url.href, { replace: true })).then(() => {});
      }
    },
    update<T extends Json>(address: DisplayAddress<T> | string, updater: (current: T | undefined) => T | undefined) {
      context.set(address, updater(context.get<T>(address)));
    },
    resetState(name) {
      return resetDisplayState(name, stateDefinitions, (address, value) => context.set(address, value));
    },
    registerEffectHandler(type, handler) {
      const handlers = effectHandlers.get(type) ?? new Set<() => void>();
      handlers.add(handler); effectHandlers.set(type, handlers);
      return () => { handlers.delete(handler); if (!handlers.size) effectHandlers.delete(type); };
    },
    async dispatchEffect(effect) {
      if (effect.type === 'state.set') await context.set(stateKey(effect.name), effect.value);
      else if (effect.type === 'state.reset') await context.resetState(effect.name);
      else for (const handler of effectHandlers.get(effect.type) ?? []) handler();
    },
    configureState(definitions, namespace, nextHost) {
      const priorKeys = Object.keys(stateDefinitions);
      stateDefinitions = definitions;
      stateNamespace = namespace;
      host = nextHost;
      for (const name of priorKeys) if (!Object.hasOwn(definitions, name)) delete values[stateKey(name)];
      for (const [name, declaration] of Object.entries(definitions)) {
        const current = values[stateKey(name)];
        if (current === undefined || !valid(declaration.schema, current)) values[stateKey(name)] = declaration.default;
      }
      loadStateFromUrl();
    },
    syncUrlState() { loadStateFromUrl(); },
  };
  return context;
}

export function provideDisplayContext(): DisplayContext {
  const context = createDisplayContext();
  setContext(displayContextKey, context);
  return context;
}

export function useDisplayContext(): DisplayContext {
  const context = getContext<DisplayContext | undefined>(displayContextKey);
  if (!context) throw new Error('Display context is only available inside a display document');
  return context;
}
