<script lang="ts">
  import type { Json } from '@workcore/core';
  import { useSource } from './source.svelte.js';
  import { useRendererSources } from './renderer-context.js';
  import { readPath, text } from './data.js';
  import EmptyState from './EmptyState.svelte';
  import { Badge } from './components/ui/badge/index.js';
  import * as Card from './components/ui/card/index.js';
  import Alert from './Alert.svelte';

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

<section class="task-board grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] items-start gap-4" aria-label={`Tasks grouped by ${groupBy}`}>
  {#if loader.state.status === 'loading' && !rows.length}<div class="skeleton" aria-label="Loading task board"></div>
  {:else if loader.state.status === 'error'}<Alert variant="destructive"><p>{loader.state.error?.message ?? 'Task board unavailable'}</p></Alert>
  {:else if !groups.length}<EmptyState description="No tasks in this project." />
  {:else}{#each groups as [group, items]}<Card.Root class="min-w-0"><Card.Header class="flex flex-row items-center justify-between gap-2"><Card.Title>{group}</Card.Title><Badge variant="secondary" aria-label={`${items.length} tasks`}>{items.length}</Badge></Card.Header><Card.Content><ul class="grid list-none gap-2 p-0">{#each items as row}{@const ownerId = text(row.ownerId)}<li><Card.Root size="sm" class="transition-colors hover:border-primary/50"><Card.Content class="gap-1.5"><strong class="leading-snug">{text(row.title)}</strong><small class="truncate font-mono text-xs text-muted-foreground" title={ownerId}>{ownerId ? `Owner · ${ownerId.slice(0, 8)}${ownerId.length > 8 ? '…' : ''}` : 'Unassigned'}</small></Card.Content></Card.Root></li>{/each}</ul></Card.Content></Card.Root>{/each}{/if}
</section>
