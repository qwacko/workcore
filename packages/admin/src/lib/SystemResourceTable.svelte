<script lang="ts">
  import type { Column, Json } from '@workcore/core';
  import DataTable from './DataTable.svelte';
  import { label } from './data.js';
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
    {#if resource === 'runs'}{#if runHref}<a class="button small" href={runHref(String(row.id))}>Inspect run</a>{/if}{#if ['failed', 'interrupted', 'cancelled'].includes(String(row.status))}<button class="small" onclick={() => oncontrol('run', String(row.id), 'retry')}>Retry</button>{/if}{/if}
    {#if resource === 'schedules'}{#if row.lastRunId && runHref}<a class="button small" href={runHref(String(row.lastRunId))}>Inspect run</a>{/if}<button class="small" onclick={() => oncontrol('schedule', String(row.id), row.enabled ? 'disable' : 'enable')}>{row.enabled ? 'Disable' : 'Enable'}</button><button class="small" onclick={() => oninspect(String(row.id))}>Details</button>{/if}
  {/snippet}
</DataTable>
