<script lang="ts">
  import { getContext } from 'svelte';
  import type { Json, RelationshipLookup } from '@workcore/core';
  import { defaults, readPath, text } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';

  let { config, title, fieldId, value, onchange, disabled = false, error }: {
    config: RelationshipLookup;
    title: string;
    fieldId: string;
    value: Json | undefined;
    onchange: (value: Json | undefined) => void;
    disabled?: boolean;
    error?: string;
  } = $props();
  const session = getContext<SessionStore>(sessionKey);
  let search = $state('');
  let options = $state<{ value: Json; label: string }[]>([]);
  let loading = $state(false);
  let failure = $state('');
  let cursor = $state<string | null>(null);
  let nextCursor = $state<string | null>(null);

  $effect(() => {
    const lookup = config;
    const currentSession = $session;
    const selected = value;
    const currentSearch = search;
    const currentCursor = cursor;
    if (!lookup || !currentSession) { options = []; return; }
    let active = true;
    const timer = setTimeout(() => {
      const operation = currentSession.manifest.view[lookup.source];
      if (!operation) { failure = 'The authorised lookup is unavailable.'; return; }
      const query = currentSession.client.query as (name: string, input: Json) => Promise<{ data: Json }>;
      const makeInput = (pairs: [string | undefined, unknown][]) => {
        const input = defaults(operation.input) as Record<string, Json>;
        for (const [field, fieldValue] of pairs) if (field && field in (operation.input.properties ?? {}) && fieldValue !== undefined && fieldValue !== null && fieldValue !== '') input[field] = fieldValue as Json;
        return input as Json;
      };
      loading = true; failure = '';
      const fetch = (input: Json) => query(lookup.source, input).then(result => ({
        rows: Array.isArray(result.data) ? result.data : result.data && typeof result.data === 'object' && Array.isArray(result.data.rows) ? result.data.rows : [],
        next: result.data && typeof result.data === 'object' && !Array.isArray(result.data) && typeof result.data.nextCursor === 'string' ? result.data.nextCursor : null,
      }));
      const requests = [fetch(makeInput([[lookup.searchInput, currentSearch], [lookup.cursorInput, currentCursor]])).then(result => ({ ...result, selected: false }))];
      if (selected !== null && selected !== undefined && lookup.selectedInput) requests.push(fetch(makeInput([[lookup.selectedInput, selected]])).then(result => ({ ...result, selected: true })));
      void Promise.all(requests).then(results => {
        if (!active) return;
        const additions = results.flatMap(({ rows }) => rows.flatMap(row => {
          const optionValue = readPath(row, lookup.valuePath);
          return optionValue === undefined || optionValue === null ? [] : [{ value: optionValue as Json, label: text(readPath(row, lookup.labelPath)) }];
        }));
        options = [...new Map([...options, ...additions].map(option => [JSON.stringify(option.value), option])).values()];
        nextCursor = results.find(result => !result.selected)?.next ?? null;
      }).catch(cause => {
        if (active) { options = []; failure = cause instanceof Error ? cause.message : 'Relationship lookup failed'; }
      }).finally(() => { if (active) loading = false; });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  });
</script>

<input type="search" aria-label={`Search ${title}`} value={search} {disabled} placeholder="Search options…" oninput={event => { search = event.currentTarget.value; cursor = null; options = []; nextCursor = null; }} />
<select id={fieldId} disabled={disabled} value={JSON.stringify(value ?? '')} onchange={event => onchange(event.currentTarget.value === '' ? undefined : JSON.parse(event.currentTarget.value) as Json)} aria-invalid={!!error}>
  <option value="">Choose {title.toLowerCase()}…</option>
  {#each options as option}<option value={JSON.stringify(option.value)}>{option.label}</option>{/each}
</select>
{#if nextCursor}<button type="button" class="text-button small" disabled={disabled || loading} onclick={() => cursor = nextCursor}>Load more options</button>{/if}
{#if loading}<span class="help" role="status">Loading authorised options…</span>{/if}
{#if failure}<span class="error" role="status">{failure}</span>{/if}
{#if error}<span class="error" role="alert">{error}</span>{/if}
