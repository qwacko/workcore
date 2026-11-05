<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Badge } from './components/ui/badge/index.js';
  let { tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'error'; children: Snippet } = $props();
  const variant = $derived(tone === 'error' ? 'destructive' : tone === 'success' ? 'default' : 'secondary');
</script>
<Badge {variant}>{@render children()}</Badge>
