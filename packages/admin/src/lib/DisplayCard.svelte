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

<Card.Root class={`mb-5 ${wide ? 'wide' : ''}`}>
  {#if title || description}<Card.Header><div>{#if title}<Card.Title>{title}</Card.Title>{/if}{#if description}<Card.Description>{description}</Card.Description>{/if}</div></Card.Header>{/if}
  <Card.Content>{@render children()}</Card.Content>
</Card.Root>
