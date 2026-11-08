<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Card from './components/ui/card/index.js';
  let { title, description, wide = false, children }: {
    title?: string;
    description?: string;
    wide?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class={wide ? 'wide' : ''}><Card.Root class="mb-5">
  {#if title || description}<Card.Header><div>{#if title}<h2 class="text-base font-medium leading-normal">{title}</h2>{/if}{#if description}<Card.Description>{description}</Card.Description>{/if}</div></Card.Header>{/if}
  <Card.Content>{@render children()}</Card.Content>
</Card.Root></section>
