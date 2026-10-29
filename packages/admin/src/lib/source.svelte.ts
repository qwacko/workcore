import { onDestroy } from 'svelte';
import type { Json } from '@workcore/core';
import type { LiveState, Sources, SourceReference } from '@workcore/client';

export type SourceLoader<TData = Json> = {
  readonly state: LiveState<TData>;
  readonly data: TData | undefined;
  refresh(): void;
};

function stableJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Svelte lifecycle adapter over the shared, reference-counted client source manager. */
export function useSource(
  getSources: () => Sources | null,
  getSource: () => SourceReference | null,
  getInput: () => Json,
): SourceLoader<Json>;
export function useSource<TData>(
  getSources: () => Sources | null,
  getSource: () => SourceReference | null,
  getInput: () => Json,
  decode: (value: Json) => TData,
): SourceLoader<TData>;
export function useSource<TData = Json>(
  getSources: () => Sources | null,
  getSource: () => SourceReference | null,
  getInput: () => Json,
  decode?: (value: Json) => TData,
): SourceLoader<TData> {
  let state = $state<LiveState<TData>>({ status: 'loading', revision: 0 });
  let current: { sources: Sources; kind: SourceReference['kind']; name: string; input: string; stop: () => void } | undefined;

  $effect(() => {
    const sources = getSources();
    const source = getSource();
    const input = getInput();
    if (!sources || !source) {
      current?.stop();
      current = undefined;
      state = { status: 'loading', revision: 0 };
      return;
    }
    const inputKey = stableJson(input);
    if (current?.sources === sources && current.kind === source.kind && current.name === source.name && current.input === inputKey) return;
    current?.stop();
    state = { status: 'loading', revision: 0 };
    let active = true;
    const unwatch = sources.watch(source, input, next => {
      if (!active) return;
      if (next.data !== undefined && decode) {
        try { state = { ...next, data: decode(next.data) }; }
        catch (error) {
          state = { status: 'error', revision: next.revision, error: { code: 'INVALID_SOURCE_DATA', message: error instanceof Error ? error.message : 'Source data did not match its declared type' } };
        }
      } else state = next as LiveState<TData>;
    });
    const stop = () => { active = false; unwatch(); };
    current = { sources, kind: source.kind, name: source.name, input: inputKey, stop };
  });

  onDestroy(() => { current?.stop(); current = undefined; });

  return {
    get state() { return state; },
    get data() { return state.data; },
    refresh() {
      const source = getSource();
      if (source) getSources()?.refresh(source, getInput());
    },
  };
}
