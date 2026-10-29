<script lang="ts">
  import type { Json } from '@workcore/core';
  import { useSource } from './source.svelte.js';
  import { useRendererSources } from './renderer-context.js';
  import { readPath, text } from './data.js';

  let { props, input = {} }: { props: Json; input?: Json } = $props();
  const config = $derived(props && typeof props === 'object' && !Array.isArray(props) ? props as Record<string, Json> : {});
  const sources = useRendererSources();
  const groupBy = $derived(config.groupBy === 'owner' ? 'owner' : 'status');
  const projectId = $derived(readPath(input, 'projectId') ?? 'inbox');
  const loader = useSource(() => sources, () => ({ kind: 'view', name: 'tasks' }), () => ({ projectId }));
  const rows = $derived(Array.isArray(loader.data) ? loader.data.filter((item): item is Record<string, Json> => !!item && typeof item === 'object' && !Array.isArray(item)) : []);
  const groups = $derived.by(() => {
    const values = new Map<string, Record<string, Json>[]>();
    for (const row of rows) {
      const key = groupBy === 'owner' ? text(row.ownerId) || 'Unassigned' : row.done ? 'Completed' : 'Open';
      values.set(key, [...(values.get(key) ?? []), row]);
    }
    return [...values.entries()];
  });
</script>

<section class="task-board" aria-label={`Tasks grouped by ${groupBy}`}>
  {#if loader.state.status === 'loading' && !rows.length}<div class="skeleton" aria-label="Loading task board"></div>
  {:else if loader.state.status === 'error'}<p class="notice error" role="alert">{loader.state.error?.message ?? 'Task board unavailable'}</p>
  {:else if !groups.length}<div class="empty">No tasks in this project.</div>
  {:else}{#each groups as [group, items]}<section class="task-lane"><h3>{group}<span class="badge">{items.length}</span></h3><ul>{#each items as row}<li><strong>{text(row.title)}</strong><small>{text(row.ownerId)}</small></li>{/each}</ul></section>{/each}{/if}
</section>

<style>
  .task-board { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:1rem; align-items:start }
  .task-lane { background:var(--surface-2, #f4f5f7); border-radius:.75rem; padding:1rem; min-width:0 }
  .task-lane h3 { display:flex; justify-content:space-between; align-items:center; margin:0 0 .75rem }
  .task-lane ul { display:grid; gap:.5rem; list-style:none; margin:0; padding:0 }
  .task-lane li { background:var(--surface-1, white); border-radius:.5rem; padding:.75rem; display:grid; gap:.35rem }
  .task-lane small { color:var(--muted-foreground, #666); overflow-wrap:anywhere }
</style>
