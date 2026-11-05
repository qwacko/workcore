<script lang="ts">
  import type { Column, Json } from '@workcore/core';
  import DataTable from './DataTable.svelte';
  import { label } from './data.js';
  import { Button } from './components/ui/button/index.js';
  let { resource, rows, columns = [], runHref, oncontrol, oninspect }: {
    resource: 'runs' | 'schedules' | 'tables' | 'history';
    rows: Record<string, Json>[];
    columns?: { name: string; label: string; format: 'text' | 'badge' | 'date'; hidden?: boolean }[];
    runHref?: (runId: string) => string;
    oncontrol: (resource: 'run' | 'schedule', id: string, action: 'retry' | 'cancel' | 'enable' | 'disable') => void;
    oninspect: (id: string) => void;
  } = $props();
  const shownColumns = $derived<Column[]>(resource === 'tables' && columns.length
    ? columns.filter(column => !column.hidden).map(column => ({ path: column.name, label: column.label, format: column.format }))
    : Object.keys(rows[0] ?? {}).map(name => ({ path: name, label: label(name) })));
</script>

<DataTable rows={rows} columns={shownColumns} hasActions={resource === 'runs' || resource === 'schedules'}>
  {#snippet rowActions(value: Json)}
    {@const row = value as Record<string, Json>}
    {#if resource === 'runs'}{#if runHref}<Button size="sm" variant="outline" href={runHref(String(row.id))}>Inspect run</Button>{/if}{#if ['failed', 'interrupted', 'cancelled'].includes(String(row.status))}<Button size="sm" variant="outline" onclick={() => oncontrol('run', String(row.id), 'retry')}>Retry</Button>{/if}{/if}
    {#if resource === 'schedules'}{#if row.lastRunId && runHref}<Button size="sm" variant="outline" href={runHref(String(row.lastRunId))}>Inspect run</Button>{/if}<Button size="sm" variant="outline" onclick={() => oncontrol('schedule', String(row.id), row.enabled ? 'disable' : 'enable')}>{row.enabled ? 'Disable' : 'Enable'}</Button><Button size="sm" variant="ghost" onclick={() => oninspect(String(row.id))}>Details</Button>{/if}
  {/snippet}
</DataTable>
