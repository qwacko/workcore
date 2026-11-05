<script lang="ts">
  import type { Column, Json, JsonSchema, ManifestBlock } from '@workcore/core';
  import { date, label, readPath, text } from './data.js';
  import { getContext } from 'svelte';
  import { rendererRegistryKey, type RendererRegistryContext } from './renderer-context.js';
  let { block, data, schema, input = {} }: { block: Extract<ManifestBlock, { kind: 'record' }>; data: Json; schema: JsonSchema; input?: Json } = $props();
  const getRenderers = getContext<RendererRegistryContext>(rendererRegistryKey);
  const renderers = $derived(getRenderers?.() ?? {});
  const fields = $derived((block.fields ?? Object.keys(schema.properties ?? {}).filter(path => !schema.properties?.[path]?.['x-workcore']?.hidden).map(path => ({ path, label: schema.properties?.[path]?.title ?? label(path) }))) as Column[]);
</script>

{#if data === null || typeof data !== 'object'}<dl class="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-6 py-2"><div><dt class="text-sm text-muted-foreground">Value</dt><dd class="mt-2 break-words text-2xl font-semibold">{text(data)}</dd></div></dl>
{:else}<dl class="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-6 py-2">
  {#each fields as field (field.path)}
    {@const CustomCell = field.renderer ? renderers[field.renderer] : undefined}
    <div><dt class="text-sm text-muted-foreground">{field.label ?? label(field.path)}</dt><dd class="mt-2 break-words text-2xl font-semibold">{#if CustomCell}<CustomCell value={readPath(data, field.path) ?? null} row={data} column={field} {input} />{:else}{#if field.renderer}<span class="help" role="status">Cell renderer “{field.renderer}” is not registered.</span>{/if}{#if field.format === 'date'}{date(readPath(data, field.path))}{:else}{text(readPath(data, field.path))}{/if}{/if}</dd></div>
  {/each}
</dl>{/if}
