<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import type { ManifestAction, ManifestBlock } from '@workcore/core';
  import { sessionKey, type SessionStore } from '../../../../../lib/session.js';
  import { label } from '../../../../../lib/data.js';
  import ActionForm from '../../../../../lib/ActionForm.svelte';
  import SourcePanel from '../../../../../lib/SourcePanel.svelte';
  const session = getContext<SessionStore>(sessionKey);
  const kind = $derived(page.params.kind as 'view' | 'query' | 'mutation' | 'job');
  const name = $derived(page.params.name ?? '');
  const operation = $derived(['view', 'query', 'mutation', 'job'].includes(kind) && $session && Object.hasOwn($session.manifest[kind], name) ? $session.manifest[kind][name] : undefined);
  const action = $derived({ kind: 'form', operation: { kind, name }, label: operation?.ui?.submitLabel ?? (kind === 'job' ? 'Launch run' : 'Execute') } as ManifestAction);
  const block = $derived({ id: `operation-${name}`, kind: operation?.ui?.presentation === 'markdown' ? 'markdown' : operation?.ui?.presentation === 'record' ? 'record' : operation?.ui?.presentation === 'json' ? 'json' : operation?.output.type === 'array' || operation?.output.properties?.rows ? 'collection' : 'json', presentation: operation?.ui?.presentation === 'list' ? 'list' : 'table', source: { kind, name } } as ManifestBlock);
</script>
{#if operation}
  <div class="page-heading"><div><div class="eyebrow">{label(kind)} / operation explorer</div><h1>{operation.ui?.label ?? label(name)}</h1><p>{operation.ui?.description ?? 'Validated and authorised server execution.'}</p></div><code>{name}</code></div>
  <section class="panel">
    {#key kind + name}
      {#if kind === 'mutation' || kind === 'job'}<ActionForm {action} />{:else}<SourcePanel {block} />{/if}
    {/key}
    <details class="schema-details"><summary>Inspect schemas</summary><h3>Input</h3><pre>{JSON.stringify(operation.input, null, 2)}</pre><h3>Output</h3><pre>{JSON.stringify(operation.output, null, 2)}</pre></details>
  </section>
{:else}<div class="empty"><h1>Operation unavailable</h1><p>It does not exist or your current permissions do not allow it.</p></div>{/if}
