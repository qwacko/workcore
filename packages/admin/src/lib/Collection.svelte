<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Json, JsonSchema, ManifestAction, ManifestBlock } from '@workcore/core';
  import { actionValues, condition, date, label, operationFor, readPath, rowSchema, schemaAt, text, validation } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import ActionForm from './ActionForm.svelte';
  import Modal from './Modal.svelte';
  let { block, data, schema }: { block: ManifestBlock; data: Json; schema: JsonSchema } = $props();
  const session = getContext<SessionStore>(sessionKey);
  let selected = $state<{ action: ManifestAction; row: Json } | null>(null);
  let feedback = $state('');
  let failure = $state('');
  let pending = $state(false);
  const requestIds = new Map<string, string>();
  const prefix = $derived(`filter.${block.id}.`);
  const search = $derived(page.url.searchParams.get(prefix + 'search') ?? '');
  const sorting = $derived(page.url.searchParams.get(prefix + 'sort') ?? '');
  const mode = $derived(page.url.searchParams.get(prefix + 'mode') ?? block.presentation ?? 'table');
  const rows = $derived((Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.rows) ? data.rows : []) as Json[]);
  const itemSchema = $derived(rowSchema(schema));
  const columns = $derived.by(() => {
    if (block.columns) return block.columns;
    const properties = Object.entries(itemSchema.properties?.data?.properties ?? itemSchema.properties ?? {}).filter(([, schema]) => !schema['x-workcore']?.hidden);
    return properties.length ? properties.map(([path, schema]) => ({ path: itemSchema.properties?.data ? `data.${path}` : path, label: schema.title ?? label(path), format: undefined })) : [{ path: '', label: 'Value', format: undefined }];
  });
  const visible = $derived.by(() => {
    let result = rows.filter(row => {
      const haystack = (block.search ?? columns.map(column => column.path)).map(path => text(readPath(row, path))).join(' ').toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) return false;
      return (block.filters ?? []).every(filter => {
        const expected = page.url.searchParams.get(prefix + filter.path);
        return !expected || JSON.stringify(readPath(row, filter.path)) === expected;
      });
    });
    if (sorting) {
      const descending = sorting.startsWith('-');
      const path = descending ? sorting.slice(1) : sorting;
      result = [...result].sort((a, b) => {
        const left = readPath(a, path), right = readPath(b, path);
        const compared = typeof left === 'number' && typeof right === 'number' ? left - right : text(left).localeCompare(text(right));
        return descending ? -compared : compared;
      });
    }
    return result;
  });
  function setFilter(key: string, value: string) {
    const url = new URL(page.url.href);
    if (value) url.searchParams.set(prefix + key, value); else url.searchParams.delete(prefix + key);
    void goto(url, { replace: true, reset: false });
  }
  async function activate(action: ManifestAction, row: Json) {
    if (action.kind === 'form') { selected = { action, row }; return; }
    if (!$session || action.confirm && !confirm(action.confirm)) return;
    feedback = ''; failure = ''; pending = true;
    try {
      const operation = operationFor($session.manifest, action);
      if (!operation) throw new Error('Action is no longer available');
      const input = actionValues(action, row, operation.input);
      const errors = validation(operation.input, input);
      if (Object.keys(errors).length) throw new Error(Object.entries(errors).map(([name, message]) => `${name}: ${message}`).join('; '));
      const key = JSON.stringify([action.operation, input]);
      const requestId = requestIds.get(key) ?? crypto.randomUUID();
      requestIds.set(key, requestId);
      if (action.operation.kind === 'mutation') await $session.client.mutate(action.operation.name, input, requestId);
      else await $session.client.enqueue(action.operation.name, input, requestId);
      requestIds.delete(key);
      $session.sources.refresh(); feedback = `${action.label} succeeded`;
    } catch (error) { failure = error instanceof Error ? error.message : 'Command failed'; }
    finally { pending = false; }
  }
</script>

<div class="collection-toolbar">
  <label class="search-field"><span class="sr-only">Search {block.title ?? 'results'}</span><input type="search" aria-label={`Search ${block.title ?? 'results'}`} value={search} placeholder="Filter this result…" oninput={event => setFilter('search', event.currentTarget.value)} /></label>
  {#each block.filters ?? [] as filter}
    <label class="filter-field"><span>{filter.label}</span><select aria-label={filter.label} value={page.url.searchParams.get(prefix + filter.path) ?? ''} onchange={event => setFilter(filter.path, event.currentTarget.value)}><option value="">All</option>{#each filter.options as option}<option value={JSON.stringify(option.value)}>{option.label}</option>{/each}</select></label>
  {/each}
  <div class="segments" aria-label="Result presentation">
    {#each ['table', 'list', 'json'] as presentation}<button type="button" aria-pressed={mode === presentation} onclick={() => setFilter('mode', presentation)}>{label(presentation)}</button>{/each}
  </div>
</div>
<p class="help result-count">{visible.length} of {rows.length} loaded records · filters apply locally to this result{block.source?.kind === 'query' ? ' / page' : ''}</p>
{#if feedback}<p class="success" role="status">{feedback}</p>{/if}
{#if failure}<p class="error" role="alert">{failure}</p>{/if}
{#if mode === 'json'}
  <pre>{JSON.stringify(visible, null, 2)}</pre>
{:else if !visible.length}
  <div class="empty"><strong>{rows.length ? 'No matches' : 'Nothing here yet'}</strong><p>{rows.length ? 'Try changing the local filters.' : 'Create a record or choose a different server scope.'}</p></div>
{:else if mode === 'list'}
  <div class="record-list">
    {#each visible as row}
      <article class="list-item">
        <div><h3>{text(readPath(row, columns[0]?.path ?? 'id'))}</h3><dl class="inline-details">{#each columns.slice(1) as column}<div><dt>{column.label ?? label(column.path)}</dt><dd>{text(readPath(row, column.path))}</dd></div>{/each}</dl></div>
        <div class="row-actions">{#each block.actions ?? [] as action}{#if condition(action.visibleWhen, row, $session?.manifest.actor.id ?? '')}<button class="small" disabled={pending || (action.disabledWhen ? condition(action.disabledWhen, row, '') : false)} onclick={() => activate(action, row)}>{action.label}</button>{/if}{/each}</div>
      </article>
    {/each}
  </div>
{:else}
  <div class="table-wrap"><table>
    <thead><tr>{#each columns as column}<th aria-sort={sorting === column.path ? 'ascending' : sorting === '-' + column.path ? 'descending' : 'none'}><button class="column-sort" onclick={() => setFilter('sort', sorting === column.path ? '-' + column.path : column.path)}>{column.label ?? schemaAt(itemSchema, column.path).title ?? label(column.path)} {sorting === column.path ? '↑' : sorting === '-' + column.path ? '↓' : ''}</button></th>{/each}{#if block.actions?.length}<th>Actions</th>{/if}</tr></thead>
    <tbody>{#each visible as row}<tr>
      {#each columns as column}<td>{#if column.format === 'badge'}<span class="badge" data-tone={readPath(row, column.path) === true ? 'success' : 'neutral'}>{text(readPath(row, column.path))}</span>{:else if column.format === 'date'}{date(readPath(row, column.path))}{:else}{text(readPath(row, column.path))}{/if}</td>{/each}
      {#if block.actions?.length}<td><div class="row-actions">{#each block.actions as action}{#if condition(action.visibleWhen, row, $session?.manifest.actor.id ?? '')}<button class="small" disabled={pending || (action.disabledWhen ? condition(action.disabledWhen, row, '') : false)} onclick={() => activate(action, row)}>{action.label}</button>{/if}{/each}</div></td>{/if}
    </tr>{/each}</tbody>
  </table></div>
{/if}
{#if selected}
  <Modal title={selected.action.label} onclose={() => selected = null}>
    <ActionForm action={selected.action} row={selected.row} ondone={() => selected = null} />
  </Modal>
{/if}
