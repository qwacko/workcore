<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Inbox } from '@lucide/svelte';
  let { title, description, children }: { title?: string; description?: string; children?: Snippet } = $props();
</script>

<div class="flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 p-6 text-center">
  <Inbox class="size-5 text-muted-foreground" />
  {#if title}<strong class="text-sm font-medium">{title}</strong>{/if}
  {#if description}<p class="m-0 max-w-md text-sm text-muted-foreground">{description}</p>{/if}
  {#if children}{@render children()}{/if}
</div>
