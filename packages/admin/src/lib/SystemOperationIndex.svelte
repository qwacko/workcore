<script lang="ts">
  import { getContext } from 'svelte';
  import { label } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import type { Column, Json } from '@workcore/core';
  import DataTable from './DataTable.svelte';
  import { useRendererHost } from './host-context.svelte.js';
  import { Button } from './components/ui/button/index.js';
  import * as Card from './components/ui/card/index.js';
  const session = getContext<SessionStore>(sessionKey);
  const host = useRendererHost();
  function operationHref(kind: string, name: string) {
    return host.displayHref('systemOperation', { kind, name });
  }
  const columns: Column[] = [{ path: 'label', label: 'Operation' }, { path: 'description', label: 'Description' }, { path: 'name', label: 'Name' }];
  function operationRows(kind: string): Json[] {
    const entries = Object.entries($session?.manifest[kind as 'view'] ?? {});
    return entries.map(([name, operation]) => ({ kind, name, label: operation.ui?.label ?? label(name), description: operation.ui?.description ?? name }));
  }
  const systemRows = $derived(Object.entries($session?.manifest.system ?? {}).map(([name, operation]) => ({ name, label: operation.ui?.label ?? label(name), description: 'Server-authorized administrative capability' })) as Json[]);
</script>

<div class="col-span-full grid w-full min-w-0 grid-cols-1 gap-5">
  {#each ['view', 'query', 'mutation', 'job'] as kind}
    <Card.Root class="min-w-0">
      <Card.Header class="border-b pb-4"><Card.Title class="text-lg">{{ view: 'Live views', query: 'Queries', mutation: 'Mutations', job: 'Tasks and agents' }[kind]}</Card.Title><Card.Description>Available operations in this workspace</Card.Description></Card.Header>
      <Card.Content class="pt-4">
      <DataTable rows={operationRows(kind)} {columns} hasActions>
        {#snippet rowActions(value: Json)}{@const row = value as Record<string, Json>}<Button size="sm" variant="outline" href={operationHref(String(row.kind), String(row.name))}>Inspect</Button>{/snippet}
      </DataTable>
      </Card.Content>
    </Card.Root>
  {/each}
  {#if systemRows.length}<Card.Root class="min-w-0"><Card.Header class="border-b pb-4"><Card.Title class="text-lg">Built-in system operations</Card.Title><Card.Description>Server-authorized administrative capabilities</Card.Description></Card.Header><Card.Content class="pt-4"><DataTable rows={systemRows} {columns} /></Card.Content></Card.Root>{/if}
</div>
