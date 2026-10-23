<script lang="ts">
  import type { OperationViewVariant } from '@workcore/core';
  import { loadCachedChatQueryView } from './chat-query-cache.js';
  import ChartView from './ChartView.svelte';
  type QueryViewPart = { query: string; view?: string; input?: unknown; title?: string };
  type LoadedQuery = { result: unknown; presentation: OperationViewVariant };
  let { part, cacheScope = '', cacheNamespace = 'default', load } = $props<{ part: QueryViewPart; cacheScope?: string; cacheNamespace?: string; load?: ((query: string, view: string | undefined, input: unknown) => Promise<unknown>) | undefined }>();
  let result = $state<unknown>();
  let presentation = $state<OperationViewVariant>();
  let error = $state('');
  let loading = $state(false);
  let requestKey = '';
  $effect(() => {
    const query = part.query;
    const view = part.view;
    const input = part.input ?? {};
    const fetcher = load;
    let key: string;
    try { key = JSON.stringify([cacheScope, query, view ?? '', input]); }
    catch { key = JSON.stringify([cacheScope, query, view ?? '']); }
    requestKey = key;
    let cancelled = false;
    error = '';
    result = undefined;
    presentation = undefined;
    if (!fetcher) { error = 'Query views are unavailable in this chat context.'; return; }
    loading = true;
    const request = loadCachedChatQueryView(cacheNamespace, key, () => fetcher(query, view, input));
    void request.then((value: unknown) => { if (!cancelled && requestKey === key) { result = (value as LoadedQuery).result; presentation = (value as LoadedQuery).presentation; } }).catch((cause: unknown) => {
      if (!cancelled && requestKey === key) error = cause instanceof Error ? cause.message : 'Could not load this query view.';
    }).finally(() => { if (!cancelled && requestKey === key) loading = false; });
    return () => { cancelled = true; };
  });
  const rows = $derived.by(() => {
    if (!result || typeof result !== 'object') return [] as Record<string, unknown>[];
    const value = result as { rows?: unknown; items?: unknown };
    const list = Array.isArray(value.rows) ? value.rows : value.items;
    return Array.isArray(list) ? list.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)) : [];
  });
  const columns = $derived(presentation?.columns?.length ? presentation.columns : Object.keys(rows[0] ?? {}));
  function format(value: unknown) {
    try { return JSON.stringify(value, null, 2) ?? 'null'; }
    catch { return String(value); }
  }
</script>

<section class="chat-query-view">
  <strong>{part.title ?? part.query}</strong>
  {#if loading}<p class="schema-hint">Loading…</p>
  {:else if error}<p class="schema-hint">{error}</p>
  {:else if result !== undefined && presentation?.renderer === 'table'}
    {#if rows.length && columns.length}<div class="oc-table"><table><thead><tr>{#each columns as column}<th>{column}</th>{/each}</tr></thead><tbody>{#each rows as row}<tr>{#each columns as column}<td>{typeof row[column] === 'object' ? format(row[column]) : String(row[column] ?? '')}</td>{/each}</tr>{/each}</tbody></table></div>{:else}<p class="schema-hint">No rows returned.</p>{/if}
  {:else if result !== undefined && presentation?.renderer === 'chart'}
    {#if presentation.chart}<ChartView {rows} config={presentation.chart} title={presentation.title} />{:else}<p class="schema-hint">This chart has no configuration.</p>{/if}
  {:else if result !== undefined}<pre>{format(result)}</pre>{/if}
</section>

<style>
  .chat-query-view { margin: .5rem 0; padding: .75rem; border: 1px solid var(--border); border-radius: var(--radius); }
  .chat-query-view pre { max-height: 20rem; overflow: auto; white-space: pre-wrap; }
</style>
