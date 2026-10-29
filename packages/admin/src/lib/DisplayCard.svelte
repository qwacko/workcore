<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, description, wide = false, children }: {
    title?: string;
    description?: string;
    wide?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="panel" class:wide>
  {#if title || description}<header class="panel-heading"><div>{#if title}<h2>{title}</h2>{/if}{#if description}<p>{description}</p>{/if}</div></header>{/if}
  {@render children()}
</section>
