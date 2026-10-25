<script lang="ts">
  import { getContext } from 'svelte';
  import type { Manifest } from '@workcore/core';
  import { sessionKey, type SessionStore } from './session.js';
  import ActionForm from './ActionForm.svelte';
  import SourcePanel from './SourcePanel.svelte';
  let { definition }: { definition: Manifest['ui']['pages'][string] } = $props();
  const session = getContext<SessionStore>(sessionKey);
</script>
<div class="page-heading"><div><div class="eyebrow">Workspace application</div><h1>{definition.title}</h1>{#if definition.description}<p>{definition.description}</p>{/if}</div><span class="badge">Manifest-driven</span></div>
<div class="page-grid">
  {#each definition.blocks as block (block.id)}
    <section class="panel" class:wide={block.kind === 'collection' || block.kind === 'chat'}>
      <div class="panel-heading"><div><h2>{block.title ?? (block.source ? $session?.manifest[block.source.kind][block.source.name]?.ui?.label ?? block.source.name : block.action?.label)}</h2>{#if block.description}<p>{block.description}</p>{/if}</div></div>
      {#if block.kind === 'form' && block.action}<ActionForm action={block.action} />{:else}<SourcePanel {block} />{/if}
    </section>
  {/each}
</div>
