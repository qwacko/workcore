<script lang="ts">
  import { getContext } from 'svelte';
  import { sessionKey, type SessionStore } from '../../lib/session.js';
  import AdminPage from '../../lib/AdminPage.svelte';
  const session = getContext<SessionStore>(sessionKey);
</script>
{#if $session?.manifest.ui.pages.overview}
  <AdminPage definition={$session.manifest.ui.pages.overview} />
{:else if $session}
  <div class="page-heading"><div><div class="eyebrow">Your workspace</div><h1>{$session.manifest.ui.title}</h1><p>{$session.manifest.ui.description}</p></div></div>
  <section class="panel"><h2>Start exploring</h2><p>Use the navigation to open an application page, inspect a live view, execute a mutation, or check background work.</p><p class="help">All operations are validated and authorised on the server. The console does not edit records directly.</p></section>
{/if}
