<script lang="ts">
  import { getContext } from 'svelte';
  import type { Column, Json, JsonSchema, ManifestAction, ManifestBlock } from '@workcore/core';
  import { actionValues, operationFor, readPath, rowSchema, schemaAt, validation } from './data.js';
  import { useCollectionView } from './collection-view.svelte.js';
  import { useDisplayContext } from './display-context.svelte.js';
  import { sessionKey, type SessionStore } from './session.js';
  import ActionForm from './ActionForm.svelte';
  import Modal from './Modal.svelte';
  import CollectionToolbar from './CollectionToolbar.svelte';
  import CollectionRows from './CollectionRows.svelte';
import { rendererRegistryKey, type RendererRegistryContext } from './renderer-context.js';
  import { embedContextKey, type EmbedContext } from './embed-context.svelte.js';
  import { useRendererHost } from './host-context.svelte.js';
  import { runSuccessEffects } from './success-effects.js';

  let { block, data, schema, input = {}, scope = () => {} }: { block: Extract<ManifestBlock, { kind: 'collection' }>; data: Json; schema: JsonSchema; input?: Json; scope?: (input: Json) => void } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const host = useRendererHost();
  const displayContext = useDisplayContext();
  const embed = getContext<EmbedContext>(embedContextKey);
  const getRenderers = getContext<RendererRegistryContext>(rendererRegistryKey);
  const renderers = $derived(getRenderers?.() ?? {});
  let selected = $state<{ action: ManifestAction; row: Json } | null>(null);
  let feedback = $state('');
  let failure = $state('');
  let pending = $state(false);
  const prefix = $derived(embed?.embedded ? `filter.${embed.instanceId}.${block.id}.` : `filter.${block.id}.`);
  function stateValue(key: string): string | undefined {
    if (embed?.memoryOnly) { const value = displayContext.get<string>(prefix + key); return value; }
    return host.location().searchParams.get(prefix + key) ?? undefined;
  }
  const search = $derived(stateValue('search') ?? '');
  const sorting = $derived(stateValue('sort') ?? '');
  const mode = $derived(stateValue('mode') ?? block.presentation ?? 'table');
  const filterValues = $derived(Object.fromEntries((block.filters ?? []).map(filter => [filter.path, stateValue(filter.path) ?? ''])));
  const rows = $derived((Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.rows) ? data.rows : []) as Json[]);
  const nextCursor = $derived(data && typeof data === 'object' && !Array.isArray(data) && typeof data.nextCursor === 'string' ? data.nextCursor : null);
  const cursorInput = $derived(['after', 'cursor'].find(key => Object.hasOwn($session?.manifest[block.source.kind][block.source.name]?.input.properties ?? {}, key)));
  const itemSchema = $derived(rowSchema(schema));
  const columns: Column[] = $derived.by(() => {
    if (block.columns) return block.columns;
    const properties = Object.entries(itemSchema.properties?.data?.properties ?? itemSchema.properties ?? {}).filter(([, field]) => !field['x-workcore']?.hidden);
    return properties.length ? properties.map(([path, field]) => ({ path: itemSchema.properties?.data ? `data.${path}` : path, label: field.title, format: undefined })) : [{ path: '', label: 'Value', format: undefined }];
  });
  const view = useCollectionView(() => rows, () => ({
    search,
    searchPaths: block.search ?? columns.map(column => column.path),
    filters: (block.filters ?? []).map(filter => ({ path: filter.path, value: filterValues[filter.path] || undefined })),
    sorting,
  }));
  const visible = $derived(view.rows);
  const selectionAddress = $derived(`selection.${embed?.instanceId ?? 'display'}.${block.id}`);
  const selectedKey = $derived(displayContext.get(selectionAddress));

  function setFilter(key: string, value: string) {
    if (embed?.memoryOnly) { displayContext.set(prefix + key, value || undefined); return; }
    const url = new URL(host.location().href);
    if (value) url.searchParams.set(prefix + key, value);
    else url.searchParams.delete(prefix + key);
    void host.navigate(url.href, { replace: true });
  }
  function selectRow(row: Json) {
    if (!block.selection) return;
    const key = readPath(row, block.selection.key);
    if (key !== undefined) displayContext.update(selectionAddress, current => JSON.stringify(current) === JSON.stringify(key) ? undefined : key);
  }
  async function activate(action: ManifestAction, row: Json) {
    if (action.kind === 'form') { selected = { action, row }; return; }
    if (!$session || (action.confirm && !confirm(action.confirm))) return;
    feedback = ''; failure = ''; pending = true;
    try {
      const operation = operationFor($session.manifest, action);
      if (!operation) throw new Error('Action is no longer available');
      const actionInput = actionValues(action, row, operation.input);
      const errors = validation(operation.input, actionInput);
      if (Object.keys(errors).length) throw new Error(Object.entries(errors).map(([name, message]) => `${name}: ${message}`).join('; '));
      const scope = `collection:${block.id}:${action.operation.kind}:${action.operation.name}:${JSON.stringify(readPath(row, 'id') ?? row)}`;
      const response = await $session.actions.execute(scope, action.operation, actionInput);
      await runSuccessEffects(action, response.data, {
        displayContext, host, refreshSources: () => $session?.sources.refresh(), resetForm: () => {},
      });
      feedback = `${action.label} succeeded`;
    } catch (error) { failure = error instanceof Error ? error.message : 'Command failed'; }
    finally { pending = false; }
  }
  function detailHref(row: Json) {
    if (!block.detail || !$session) return '#';
    const bound: Record<string, Json> = {};
    for (const [name, path] of Object.entries(block.detail.bind)) {
      const value = readPath(row, path);
      if (value !== undefined) bound[name] = value;
    }
    return host.displayHref(block.detail.display, bound);
  }
</script>

<CollectionToolbar {block} {search} {mode} {filterValues} onfilter={setFilter} />
{#if feedback}<p class="success" role="status">{feedback}</p>{/if}
{#if failure}<p class="error" role="alert">{failure}</p>{/if}
<CollectionRows {block} rows={visible} total={rows.length} {columns} {itemSchema} {mode} {sorting} {selectedKey} {input} registry={renderers} actorId={$session?.manifest.actor.id ?? ''} {pending} onselect={selectRow} onaction={activate} onsort={path => setFilter('sort', sorting === path ? `-${path}` : path)} {detailHref} />
{#if nextCursor && cursorInput}<div class="pagination"><button onclick={() => scope({ ...(input as Record<string, Json>), [cursorInput!]: nextCursor })}>Next page →</button></div>{/if}
{#if selected}<Modal title={selected.action.label} onclose={() => selected = null}><ActionForm action={selected.action} row={selected.row} ondone={() => selected = null} /></Modal>{/if}
