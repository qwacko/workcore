import type { Json } from '@workcore/core';
import type { LiveState, RuntimeClient, Subscription } from './index.js';

/** Stable JSON keys for deduplicating equivalent inputs, independent of object key order. */
export function sourceKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sourceKey).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${sourceKey(value)}`).join(',')}}`;
  return JSON.stringify(value);
}
type Source = { kind: 'view' | 'query' | 'resource'; name: string };
type Entry = {
  source: Source; input: Json; state: LiveState<Json>; listeners: Set<(state: LiveState<Json>) => void>;
  subscription?: Subscription<any>; timer?: ReturnType<typeof setInterval>; generation: number; loading: boolean;
  dirty: boolean;
};

/** Reference-counted reactive sources. No framework dependency and no second WebSocket implementation. */
export function createSources(client: RuntimeClient) {
  const entries = new Map<string, Entry>();
  function notify(listener: (state: LiveState<Json>) => void, state: LiveState<Json>) { try { listener(state); } catch (error) { console.error('Workcore source listener failed', error); } }
  function emit(entry: Entry) { for (const listener of entry.listeners) notify(listener, entry.state); }
  async function refresh(entry: Entry) {
    if (entry.loading) { entry.dirty = true; return; }
    entry.loading = true;
    const generation = entry.generation;
    try {
      const result = entry.source.kind === 'resource'
        ? { data: await client.inspect(entry.source.name, (entry.input as { after?: string }).after), revision: 0 }
        : await client.query(entry.source.name, entry.input);
      if (generation !== entry.generation) return;
      entry.state = { status: 'live', data: result.data, revision: result.revision };
    } catch (error) {
      if (generation !== entry.generation) return;
      entry.state = { status: 'error', revision: 0, error: { code: (error as { code?: string }).code ?? 'REQUEST_FAILED', message: error instanceof Error ? error.message : 'Request failed' } };
    } finally {
      entry.loading = false;
      if (generation === entry.generation) emit(entry);
      if (generation === entry.generation && entry.dirty && entry.listeners.size) { entry.dirty = false; void refresh(entry); }
    }
  }
  function dispose(entry: Entry) {
    entry.generation++;
    entry.subscription?.unsubscribe();
    if (entry.timer) clearInterval(entry.timer);
  }
  return {
    watch(source: Source, input: Json, listener: (state: LiveState<Json>) => void): () => void {
      const key = sourceKey([source.kind, source.name, input]);
      let entry = entries.get(key);
      if (!entry) {
        entry = { source, input, state: { status: 'loading', revision: 0 }, listeners: new Set(), generation: 0, loading: false, dirty: false };
        entries.set(key, entry);
      }
      const active = entry;
      active.listeners.add(listener);
      notify(listener, active.state);
      if (active.listeners.size === 1) {
        if (source.kind === 'view') active.subscription = client.subscribe(source.name, input, state => { active.state = state; emit(active); });
        else {
          void refresh(active);
          if (source.kind === 'resource') active.timer = setInterval(() => { void refresh(active); }, 3000);
        }
      }
      return () => { active.listeners.delete(listener); if (!active.listeners.size) { dispose(active); entries.delete(key); } };
    },
    refresh() { for (const entry of entries.values()) if (entry.source.kind !== 'view') void refresh(entry); },
    close() { for (const entry of entries.values()) dispose(entry); entries.clear(); },
  };
}
