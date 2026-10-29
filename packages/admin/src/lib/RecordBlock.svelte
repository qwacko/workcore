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

{#if data === null || typeof data !== 'object'}<dl class="record-fields"><div><dt>Value</dt><dd>{text(data)}</dd></div></dl>
{:else}<dl class="record-fields">
  {#each fields as field (field.path)}
    {@const CustomCell = field.renderer ? renderers[field.renderer] : undefined}
    <div><dt>{field.label ?? label(field.path)}</dt><dd>{#if CustomCell}<CustomCell value={readPath(data, field.path) ?? null} row={data} column={field} {input} />{:else}{#if field.renderer}<span class="help" role="status">Cell renderer “{field.renderer}” is not registered.</span>{/if}{#if field.format === 'date'}{date(readPath(data, field.path))}{:else}{text(readPath(data, field.path))}{/if}{/if}</dd></div>
  {/each}
</dl>{/if}
