<script lang="ts">
  import { setContext } from 'svelte';
  import { writable } from 'svelte/store';
  import { page } from '$app/state';
  import { connect, sessionKey, type Session } from '../../lib/session.js';
  import { label } from '../../lib/data.js';
  let { children } = $props();
  const session = writable<Session | null>(null);
  setContext(sessionKey, session);
  let error = $state('');
  let menuOpen = $state(false);
  const workspaceId = $derived(page.params.workspace);
  const root = $derived(`/admin/${encodeURIComponent(page.params.workspace ?? '')}`);
  $effect(() => {
    const workspace = workspaceId;
    let active = true;
    let current: Session | null = null;
    session.set(null); error = '';
    if (workspace) void connect(workspace).then(value => {
      if (!active) { value.close(); return; }
      current = value; session.set(value);
    }).catch(failure => { if (active) error = failure instanceof Error ? failure.message : 'Unable to connect'; });
    return () => { active = false; current?.close(); };
  });
  $effect(() => { const path = page.url.pathname; if (path) menuOpen = false; });
</script>

<svelte:head><title>{$session?.manifest.ui.title ?? 'Workcore'} · Workspace console</title></svelte:head>
<div class="app-shell">
  <aside class:open={menuOpen}>
    <a class="brand" href={root}><span class="brand-mark">w</span><span>workcore<span class="brand-subtitle">WORKSPACE CONSOLE</span></span></a>
    <div class="workspace-card"><span class="workspace-icon">▦</span><div><strong>{$session?.manifest.ui.title ?? page.params.workspace}</strong><span class="help">{page.params.workspace} / Cloudflare</span></div></div>
    <nav aria-label="Workspace navigation">
      <div class="nav-label">Application</div>
      <a aria-label="Overview" href={root} class:active={page.url.pathname === root || page.url.pathname === root + '/'}><span aria-hidden="true">◈</span> <span>Overview</span></a>
      {#each Object.entries($session?.manifest.ui.pages ?? {}).filter(([name]) => name !== 'overview') as [name, definition]}
        <a aria-label={definition.title} href={`${root}/pages/${name}`} class:active={page.url.pathname === `${root}/pages/${name}`}><span aria-hidden="true">◇</span> <span>{definition.title}</span></a>
      {/each}
      {#if $session?.manifest.runs}
        <div class="nav-label">Execution</div>
        <a aria-label="Runs" href={`${root}/resources/runs`} class:active={page.url.pathname.includes('/runs')}><span aria-hidden="true">↗</span> <span>Runs</span></a>
      {/if}
      {#if $session?.manifest.admin}
        <a aria-label="Schedules" href={`${root}/resources/schedules`} class:active={page.url.pathname.endsWith('/schedules')}><span aria-hidden="true">◷</span> <span>Schedules</span></a>
        <div class="nav-label">Administration</div>
        <a aria-label="Tables" href={`${root}/resources/tables`} class:active={page.url.pathname.endsWith('/tables')}><span aria-hidden="true">▤</span> <span>Tables</span></a>
        <a aria-label="History" href={`${root}/resources/history`} class:active={page.url.pathname.endsWith('/history')}><span aria-hidden="true">≡</span> <span>History</span></a>
      {/if}
      {#if $session?.manifest.files.enabled && $session.manifest.files.list}
        <div class="nav-label">Storage</div>
        <a aria-label="Files" href={`${root}/resources/files`} class:active={page.url.pathname.endsWith('/files')}><span aria-hidden="true">▧</span> <span>Files</span></a>
      {/if}
      <div class="nav-label">Operation explorer</div>
      {#each ['view', 'query', 'mutation', 'job'] as kind}
        <details class="nav-group"><summary>{{ view: 'Live views', query: 'Queries', mutation: 'Mutations', job: 'Tasks & agents' }[kind]}</summary>
          {#each Object.entries($session?.manifest[kind as 'view'] ?? {}) as [name, operation]}
            <a href={`${root}/operations/${kind}/${name}`} class:active={page.url.pathname === `${root}/operations/${kind}/${name}`}>{operation.ui?.label ?? label(name)}</a>
          {/each}
        </details>
      {/each}
    </nav>
    <div class="sidebar-footer"><span class="avatar">{$session?.manifest.actor.id.slice(0, 1).toUpperCase() ?? '?'}</span><div><strong>{$session?.manifest.actor.id ?? 'Connecting'}</strong><span class="help">{$session?.manifest.admin ? 'Administrator' : 'Workspace member'}</span></div><a href="/" aria-label="Switch demo identity" title="Switch identity">↪</a></div>
  </aside>
  <div class="main-column">
    <header class="topbar"><button class="icon-button mobile-only" aria-label="Toggle navigation" onclick={() => menuOpen = !menuOpen}>☰</button><span>Workspace <span class="muted">/</span> {$session?.manifest.ui.title ?? page.params.workspace}</span><span class="topbar-note"><span class="status-dot" data-status={$session ? 'live' : 'loading'}></span>{$session ? 'Signed in' : 'Connecting'}</span><a class="small" href="/">Switch identity</a></header>
    <main>
      {#if error}<section class="panel"><h1>Unable to open workspace</h1><p class="error" role="alert">{error}</p><a class="button primary" href="/">Sign in</a></section>
      {:else if $session}{@render children()}
      {:else}<div class="page-heading"><h1>Opening your workspace…</h1></div><div class="skeleton"></div>{/if}
    </main>
    <footer class="app-footer">Workcore <span>SQLite-backed · server-authorised · live by default</span></footer>
  </div>
</div>
