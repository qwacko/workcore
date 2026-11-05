<script lang="ts">
  import { getContext } from 'svelte';
  import { sessionKey, type SessionStore } from '../../lib/session.js';
  import AdminPage from '../../lib/AdminPage.svelte';
  import { registry } from '../../lib/tracker-renderers.js';
  import DisplayCard from '../../lib/DisplayCard.svelte';
  const session = getContext<SessionStore>(sessionKey);
</script>
{#if $session?.manifest.ui.displays.overview}
  <AdminPage definition={$session.manifest.ui.displays.overview} {registry} />
{:else if $session}
  <div class="mb-7"><div class="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your workspace</div><h1>{$session.manifest.ui.title}</h1><p class="max-w-3xl">{$session.manifest.ui.description}</p></div>
  <DisplayCard title="Start exploring"><p>Use the navigation to open a display, inspect a live view, execute a mutation, or check background work.</p><p class="help">All operations are validated and authorised on the server. The console does not edit records directly.</p></DisplayCard>
{/if}
