<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { sessionKey, type SessionStore } from '../../../../lib/session.js';
  import AdminPage from '../../../../lib/AdminPage.svelte';
  const session = getContext<SessionStore>(sessionKey);
  const definition = $derived($session && Object.hasOwn($session.manifest.ui.pages, page.params.name ?? '') ? $session.manifest.ui.pages[page.params.name ?? ''] : undefined);
</script>
{#if definition}<AdminPage {definition} />{:else}<div class="empty"><h1>Page unavailable</h1><p>It does not exist or you do not have access to its data sources.</p></div>{/if}
