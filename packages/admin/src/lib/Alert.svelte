<script lang="ts">
  import type { Snippet } from 'svelte';
  import { AlertCircle, CircleAlert } from '@lucide/svelte';
  let { variant = 'default', title, children }: { variant?: 'default' | 'destructive'; title?: string; children: Snippet } = $props();
</script>
<div role={variant === 'destructive' ? 'alert' : 'status'} class={`relative grid w-full grid-cols-[1rem_1fr] gap-x-3 gap-y-1 rounded-lg border p-4 text-sm ${variant === 'destructive' ? 'border-destructive/50 text-destructive [&_svg]:text-destructive' : 'bg-card text-card-foreground'}`}>
  {#if variant === 'destructive'}<AlertCircle class="mt-0.5 size-4" />{:else}<CircleAlert class="mt-0.5 size-4" />{/if}
  <div class="min-w-0">{#if title}<h2 class="mb-1 font-medium">{title}</h2>{/if}<div class="text-sm [&_p]:mb-0">{@render children()}</div></div>
</div>
