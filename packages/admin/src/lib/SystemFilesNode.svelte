<script lang="ts">
  import { getContext } from 'svelte';
  import type { Json } from '@workcore/core';
  import { sessionKey, type SessionStore } from './session.js';
  import { useSource } from './source.svelte.js';
  import DisplayCard from './DisplayCard.svelte';
  import LoadBoundary from './LoadBoundary.svelte';
  import SystemFilesView from './SystemFilesView.svelte';
  import { useTask } from './resource.svelte.js';
  import { useRendererHost } from './host-context.svelte.js';

  type FilePage = { rows: { id: string; ownerId: string; filename: string; contentType: string; size: number; status: string; createdAt: number; uploadedAt: number | null }[]; nextCursor: string | null };
  let { input = {} }: { input?: Json } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const host = useRendererHost();
  const params = $derived(input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, Json> : {});
  const after = $derived(String(host.location().searchParams.get('after') ?? params.after ?? ''));
  const files = useSource(() => $session?.sources ?? null, () => $session?.manifest.files.list ? ({ kind: 'system', name: 'files.list' }) : null, () => ({ after }));
  const filePage = $derived(files.data && typeof files.data === 'object' && !Array.isArray(files.data) ? files.data as unknown as FilePage : undefined);
  const uploadTask = useTask(async (file: File) => { if (!$session) throw new Error('Session is unavailable'); await $session.client.files.upload(file); files.refresh(); });
  const removeTask = useTask(async (id: string) => { if (!$session) throw new Error('Session is unavailable'); await $session.client.files.remove(id); files.refresh(); });
  const downloadTask = useTask(async (id: string, filename: string) => {
    if (!$session) throw new Error('Session is unavailable');
    const blob = await $session.client.files.download(id);
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  });
  const busy = $derived(uploadTask.state.status === 'pending' || removeTask.state.status === 'pending');
  const actionError = $derived(uploadTask.state.error ?? removeTask.state.error ?? downloadTask.state.error ?? '');
  async function upload(event: Event) {
    const element = event.currentTarget as HTMLInputElement;
    const file = element.files?.[0];
    if (!$session || !file) return;
    try { await uploadTask.execute(file); element.value = ''; }
    catch { /* surfaced through the task state */ }
  }
  async function download(id: string, filename: string) {
    try { await downloadTask.execute(id, filename); }
    catch { /* surfaced through the task state */ }
  }
  async function remove(id: string) {
    if (!$session || !confirm('Permanently delete this file and its stored bytes?')) return;
    try { await removeTask.execute(id); }
    catch { /* surfaced through the task state */ }
  }
  function next(cursor: string) { const url = new URL(host.location().href); url.searchParams.set('after', cursor); void host.navigate(url.href); }
</script>

{#if !$session?.manifest.files.list}<div class="notice error">This system display is not available to your current actor.</div>
{:else}<DisplayCard wide>
  {#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
  <LoadBoundary state={files.state}>
    {#snippet children(_data: Json)}
      <SystemFilesView files={filePage ?? { rows: [], nextCursor: null }} canUpload={$session?.manifest.files.upload ?? false} canDownload={$session?.manifest.files.download ?? false} canDelete={$session?.manifest.files.delete ?? false} {busy} error="" onupload={upload} ondownload={download} onremove={remove} />
      {#if filePage?.nextCursor}<div class="pagination"><button onclick={() => next(filePage.nextCursor!)}>Next page →</button></div>{/if}
    {/snippet}
  </LoadBoundary>
</DisplayCard>{/if}
