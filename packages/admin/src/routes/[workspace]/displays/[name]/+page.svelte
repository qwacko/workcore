<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { sessionKey, type SessionStore } from '../../../../lib/session.js';
  import AdminPage from '../../../../lib/AdminPage.svelte';
  import { registry } from '../../../../lib/tracker-renderers.js';
  import EmptyState from '../../../../lib/EmptyState.svelte';
  const session = getContext<SessionStore>(sessionKey);
  const definition = $derived($session && Object.hasOwn($session.manifest.ui.displays, page.params.name ?? '') ? $session.manifest.ui.displays[page.params.name ?? ''] : undefined);
</script>
{#if definition}<AdminPage {definition} name={page.params.name} {registry} />{:else}<EmptyState title="Display unavailable" description="It does not exist or you do not have access to its data sources." />{/if}
