<script lang="ts">
  import { setContext } from 'svelte';
  import { writable } from 'svelte/store';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { connect, sessionKey, type Session } from '../../lib/session.js';
  import { rendererHostKey, type RendererHost } from '../../lib/host-context.svelte.js';
  let { children } = $props();
  const session = writable<Session | null>(null);
  setContext(sessionKey, session);
  const host: RendererHost = {
    location: () => new URL(page.url.href),
    navigate: (href, options) => goto(href, options),
    displayHref: (name, input = {}) => {
      const query = new URLSearchParams(Object.entries(input).map(([key, value]) => [key, JSON.stringify(value)]));
      const back = `${page.url.pathname}${page.url.search}`;
      const workspaceRoot = `/admin/${encodeURIComponent(page.params.workspace ?? '')}`;
      if (back.startsWith(`${workspaceRoot}/`)) query.set('__back', back);
      return `/admin/${encodeURIComponent(page.params.workspace ?? '')}/displays/${encodeURIComponent(name)}${query.size ? `?${query}` : ''}`;
    },
    runHref: runId => `/admin/${encodeURIComponent(page.params.workspace ?? '')}/displays/systemRunDetail?runId=${encodeURIComponent(runId)}`,
  };
  setContext(rendererHostKey, host);
  let error = $state('');
  let menuOpen = $state(false);
  let navigation = $state<{ homeHref: string; workspaces: { id: string; label: string }[] }>({ homeHref: '/', workspaces: [] });
  const workspaceId = $derived(page.params.workspace);
  const root = $derived(`/admin/${encodeURIComponent(page.params.workspace ?? '')}`);
  $effect(() => {
    const workspace = workspaceId;
    let active = true;
    let current: Session | null = null;
    session.set(null); error = '';
    if (workspace) void connect(workspace, manifest => session.update(current => current?.workspace === workspace ? { ...current, manifest } : current)).then(value => {
      if (!active) { value.close(); return; }
      current = value; session.set(value);
    }).catch(failure => { if (active) error = failure instanceof Error ? failure.message : 'Unable to connect'; });
    return () => { active = false; current?.close(); };
  });
  $effect(() => { const path = page.url.pathname; if (path) menuOpen = false; });
  $effect(() => {
    let active = true;
    void fetch('/api/admin-navigation', { credentials: 'same-origin', cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(value => {
      if (active && value && typeof value.homeHref === 'string' && Array.isArray(value.workspaces)) navigation = value;
    }).catch(() => {});
    return () => { active = false; };
  });
</script>

<svelte:head><title>{$session?.manifest.ui.title ?? 'Workcore'} · Workspace console</title></svelte:head>
<div class="app-shell">
  <aside class:open={menuOpen}>
    <a class="brand" href={root}><span class="brand-mark">w</span><span>workcore<span class="brand-subtitle">WORKSPACE CONSOLE</span></span></a>
    <div class="workspace-card"><span class="workspace-icon">▦</span><div><strong>{$session?.manifest.ui.title ?? page.params.workspace}</strong><span class="help">{page.params.workspace} / Cloudflare</span></div></div>
    <nav aria-label="Workspace navigation">
      {#if navigation.workspaces.length}<div class="nav-label">Workspaces</div>{#each navigation.workspaces as workspace}<a href={`/admin/${encodeURIComponent(workspace.id)}`} class:active={page.params.workspace === workspace.id}><span aria-hidden="true">▦</span><span>{workspace.label}</span></a>{/each}{/if}
      {#each [...new Set(Object.values($session?.manifest.ui.displays ?? {}).filter(definition => definition.metadata.route?.listed !== false).map(definition => definition.metadata.group ?? 'Displays'))] as group}
        <div class="nav-label">{group}</div>
        {#each Object.entries($session?.manifest.ui.displays ?? {}).filter(([, definition]) => definition.metadata.route?.listed !== false && (definition.metadata.group ?? 'Displays') === group).sort(([, a], [, b]) => (a.metadata.order ?? 0) - (b.metadata.order ?? 0)) as [name, definition]}
          {#if definition.metadata.route?.path === '/'}
            <a aria-label={definition.metadata.title} href={root} class:active={page.url.pathname === root || page.url.pathname === root + '/'}><span aria-hidden="true">◈</span> <span>{definition.metadata.title}</span></a>
          {:else}
            <a aria-label={definition.metadata.title} href={`${root}/displays/${name}`} class:active={page.url.pathname === `${root}/displays/${name}`}><span aria-hidden="true">◇</span> <span>{definition.metadata.title}</span></a>
          {/if}
        {/each}
      {/each}
    </nav>
    <div class="sidebar-footer"><span class="avatar">{$session?.manifest.actor.id.slice(0, 1).toUpperCase() ?? '?'}</span><div><strong>{$session?.manifest.actor.id ?? 'Connecting'}</strong><span class="help">{$session?.manifest.admin ? 'Administrator' : 'Workspace member'}</span></div><a href={navigation.homeHref} aria-label="Exit admin" title="Back to app">↩</a></div>
  </aside>
  <div class="main-column">
    <header class="topbar"><button class="icon-button mobile-only" aria-label="Toggle navigation" onclick={() => menuOpen = !menuOpen}>☰</button><span>Workspace <span class="muted">/</span> {$session?.manifest.ui.title ?? page.params.workspace}</span><span class="topbar-note"><span class="status-dot" data-status={$session ? 'live' : 'loading'}></span>{$session ? 'Signed in' : 'Connecting'}</span><a class="small" href={navigation.homeHref}>← Back to app</a></header>
    <main>
      {#if error}<section class="panel"><h1>Unable to open workspace</h1><p class="error" role="alert">{error}</p><a class="button primary" href="/">Sign in</a></section>
      {:else if $session}{@render children()}
      {:else}<div class="page-heading"><h1>Opening your workspace…</h1></div><div class="skeleton"></div>{/if}
    </main>
    <footer class="app-footer">Workcore <span>SQLite-backed · server-authorised · live by default</span></footer>
  </div>
</div>
