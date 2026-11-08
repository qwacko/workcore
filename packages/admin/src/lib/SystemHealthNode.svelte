<script lang="ts">
  import { getContext } from 'svelte';
  import { sessionKey, type SessionStore } from './session.js';
  import { useSource } from './source.svelte.js';
  import DisplayCard from './DisplayCard.svelte';
  import LoadBoundary from './LoadBoundary.svelte';
  const session = getContext<SessionStore>(sessionKey);
  const health = useSource(() => $session?.sources ?? null, () => $session?.manifest.admin ? { kind: 'system', name: 'health.inspect' } : null, () => ({}));
</script>

<DisplayCard title="Workspace health">
  <p class="help">Live run counts, oldest queued work, pending/deleting files, migration version and next scheduled work. Times are epoch milliseconds; null means none.</p>
  <LoadBoundary state={health.state}>{#snippet children(data)}<pre>{JSON.stringify(data, null, 2)}</pre>{/snippet}</LoadBoundary>
</DisplayCard>
