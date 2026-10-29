<script lang="ts">
  import { getContext } from 'svelte';
  import { label } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import type { Column, Json } from '@workcore/core';
  import DataTable from './DataTable.svelte';
  import { useRendererHost } from './host-context.svelte.js';
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

<div class="system-operation-index">
  {#each ['view', 'query', 'mutation', 'job'] as kind}
    <section><h3>{{ view: 'Live views', query: 'Queries', mutation: 'Mutations', job: 'Tasks and agents' }[kind]}</h3>
      <DataTable rows={operationRows(kind)} {columns} hasActions>
        {#snippet rowActions(value: Json)}{@const row = value as Record<string, Json>}<a class="button small" href={operationHref(String(row.kind), String(row.name))}>Inspect</a>{/snippet}
      </DataTable>
    </section>
  {/each}
  {#if systemRows.length}<section><h3>Built-in system operations</h3><DataTable rows={systemRows} {columns} /></section>{/if}
</div>
