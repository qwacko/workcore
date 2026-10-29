import { getContext } from 'svelte';
import { get } from 'svelte/store';
import type { Json, ManifestSourceBlock } from '@workcore/core';
import { defaults, readPath } from './data.js';
import { sessionKey, type SessionStore } from './session.js';
import { useDisplayContext } from './display-context.svelte.js';
import { useSource } from './source.svelte.js';
import { embedContextKey, type EmbedContext } from './embed-context.svelte.js';
import { useRendererHost } from './host-context.svelte.js';

/** Resolve backend-authored node config, contextual inputs, URL scope and source subscription. */
export function useSourceNode(getBlock: () => ManifestSourceBlock, getDisplayInput: () => Json = () => ({})) {
  const session = getContext<SessionStore>(sessionKey);
  const host = useRendererHost();
  const displayContext = useDisplayContext();
  const embed = getContext<EmbedContext>(embedContextKey);
  const block = $derived(getBlock());
  const displayInput = $derived(getDisplayInput());
  const operation = $derived(get(session) ? get(session)!.manifest[block.source.kind][block.source.name] : undefined);
  const sourceKey = $derived(`${block.source.kind}\u0000${block.source.name}`);
  const scopePrefix = $derived(embed?.embedded ? `scope.${embed.instanceId}.${block.id}.` : `scope.${block.id}.`);
  const bindingFields = $derived.by(() => {
    const paths: string[] = [];
    const visit = (value: Json, path: string) => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value) && Object.keys(value).length === 1 && '$workcoreBinding' in value) { paths.push(path.split('.')[0]); return; }
      if (Array.isArray(value)) value.forEach((child, index) => visit(child, `${path}[${index}]`));
      else Object.entries(value).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key));
    };
    if (block.input && typeof block.input === 'object' && !Array.isArray(block.input)) visit(block.input, '');
    return [...new Set(paths)];
  });
  const resolved = $derived.by(() => {
    const value = block.input;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { input: value ?? {}, ready: true };
    let ready = true;
    const resolve = (entry: Json): Json | undefined => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).length === 1 && '$workcoreBinding' in entry) {
        const binding = (entry as { $workcoreBinding?: { kind?: string; path?: string; node?: string; name?: string } }).$workcoreBinding;
        let bound: Json | undefined;
        if (binding?.kind === 'property' && binding.path) bound = readPath(displayInput, binding.path);
        else if (binding?.kind === 'selection' && binding.node) bound = displayContext.get(`selection.${embed?.instanceId ?? 'display'}.${binding.node}`);
        else if (binding?.kind === 'state' && binding.name) bound = displayContext.get(`state.${binding.name}`);
        if (bound === undefined) { ready = false; return undefined; }
        return bound;
      }
      if (Array.isArray(entry)) return entry.map(child => resolve(child) ?? null);
      if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).flatMap(([key, child]) => {
        const value = resolve(child);
        return value === undefined ? [] : [[key, value]];
      }));
      return entry;
    };
    return { input: resolve(value) ?? {}, ready };
  });
  const inputKey = $derived.by(() => {
    const input = { ...(defaults(operation?.input ?? { type: 'object' }) as object), ...(resolved.input as object) } as Record<string, Json>;
    for (const key of Object.keys(operation?.input.properties ?? {})) {
      if (bindingFields.includes(key)) continue;
      if (embed?.memoryOnly) {
        const value = displayContext.get<Json>(scopePrefix + key);
        if (value !== undefined) input[key] = value;
      } else {
        const value = host.location().searchParams.get(scopePrefix + key);
        if (value !== null) { try { input[key] = JSON.parse(value) as Json; } catch { input[key] = value; } }
      }
    }
    return JSON.stringify(input);
  });
  const loader = useSource(() => get(session)?.sources ?? null, () => {
    if (!resolved.ready) return null;
    const [kind, name] = sourceKey.split('\u0000') as ['view' | 'query', string];
    return { kind, name };
  }, () => JSON.parse(inputKey) as Json);
  function scope(input: Json) {
    const cursorKey = ['after', 'cursor'].find(key => Object.hasOwn(operation?.input.properties ?? {}, key));
    if (cursorKey) {
      const current = JSON.parse(inputKey) as Record<string, Json>;
      const next = { ...(input as Record<string, Json>) };
      const changed = Object.keys({ ...current, ...next }).some(key => key !== cursorKey && JSON.stringify(current[key]) !== JSON.stringify(next[key]));
      if (changed) delete next[cursorKey];
      input = next;
    }
    if (embed?.memoryOnly) {
      for (const key of Object.keys(operation?.input.properties ?? {})) displayContext.set(scopePrefix + key, undefined);
      for (const [key, value] of Object.entries(input as object)) if (!bindingFields.includes(key)) displayContext.set(scopePrefix + key, value as Json);
      return;
    }
    const url = new URL(host.location().href);
    for (const key of Object.keys(operation?.input.properties ?? {})) url.searchParams.delete(scopePrefix + key);
    for (const [key, value] of Object.entries(input as object)) if (!bindingFields.includes(key)) url.searchParams.set(scopePrefix + key, JSON.stringify(value));
    void host.navigate(url.href, { replace: true });
  }
  return {
    get block() { return block; },
    get operation() { return operation; },
    get ready() { return resolved.ready; },
    get input() { return JSON.parse(inputKey) as Json; },
    get bindingFields() { return bindingFields; },
    loader,
    scope,
  };
}
