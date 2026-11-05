<script lang="ts">
  import { setContext } from 'svelte';
  import { writable } from 'svelte/store';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { connect, sessionKey, type Session } from '../../lib/session.js';
  import { rendererHostKey, type RendererHost } from '../../lib/host-context.svelte.js';
  import { Button } from '../../lib/components/ui/button/index.js';
  import * as Card from '../../lib/components/ui/card/index.js';
  import { Separator } from '../../lib/components/ui/separator/index.js';
  import { Building2, ChevronLeft, Command, Home, LayoutDashboard, Menu, PanelsTopLeft } from '@lucide/svelte';
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
<div class="grid min-h-screen grid-cols-[246px_minmax(0,1fr)] max-[700px]:block">
  <aside class="sticky top-0 flex h-screen flex-col border-r bg-background" class:open={menuOpen}>
    <a class="brand" href={root}><span class="brand-mark"><Command size={18} /></span><span>workcore<span class="brand-subtitle">WORKSPACE CONSOLE</span></span></a>
    <Card.Root size="sm" class="mx-4 mb-4"><Card.Content class="flex-row items-center gap-3"><Building2 class="size-5 text-primary" /><div class="min-w-0"><strong class="block text-sm">{$session?.manifest.ui.title ?? page.params.workspace}</strong><span class="help">{page.params.workspace} / Cloudflare</span></div></Card.Content></Card.Root>
    <nav class="flex-1 overflow-auto px-3 pb-5" aria-label="Workspace navigation">
      {#if navigation.workspaces.length}<div class="nav-label">Workspaces</div>{#each navigation.workspaces as workspace}<Button href={`/admin/${encodeURIComponent(workspace.id)}`} variant={page.params.workspace === workspace.id ? 'secondary' : 'ghost'} class="nav-item"><Building2 size={16} /><span>{workspace.label}</span></Button>{/each}{/if}
      {#each [...new Set(Object.values($session?.manifest.ui.displays ?? {}).filter(definition => definition.metadata.route?.listed !== false).map(definition => definition.metadata.group ?? 'Displays'))] as group}
        <div class="nav-label">{group}</div>
        {#each Object.entries($session?.manifest.ui.displays ?? {}).filter(([, definition]) => definition.metadata.route?.listed !== false && (definition.metadata.group ?? 'Displays') === group).sort(([, a], [, b]) => (a.metadata.order ?? 0) - (b.metadata.order ?? 0)) as [name, definition]}
          {#if definition.metadata.route?.path === '/'}
            <Button aria-label={definition.metadata.title} href={root} variant={page.url.pathname === root || page.url.pathname === root + '/' ? 'secondary' : 'ghost'} class="nav-item"><Home size={16} /> <span>{definition.metadata.title}</span></Button>
          {:else}
            <Button aria-label={definition.metadata.title} href={`${root}/displays/${name}`} variant={page.url.pathname === `${root}/displays/${name}` ? 'secondary' : 'ghost'} class="nav-item"><PanelsTopLeft size={16} /> <span>{definition.metadata.title}</span></Button>
          {/if}
        {/each}
      {/each}
    </nav>
    <Separator />
    <div class="flex items-center gap-3 border-t p-4"><span class="avatar">{$session?.manifest.actor.id.slice(0, 1).toUpperCase() ?? '?'}</span><div class="min-w-0"><strong class="block truncate text-sm">{$session?.manifest.actor.id ?? 'Connecting'}</strong><span class="help">{$session?.manifest.admin ? 'Administrator' : 'Workspace member'}</span></div><Button class="ml-auto" href={navigation.homeHref} aria-label="Exit admin" title="Back to app" variant="ghost" size="icon-sm"><ChevronLeft size={16} /></Button></div>
  </aside>
  <div class="flex min-w-0 flex-col">
    <header class="flex min-h-16 items-center gap-4 border-b px-8 text-sm text-muted-foreground max-[700px]:gap-3 max-[700px]:px-4"><Button variant="ghost" size="icon" class="mobile-only" aria-label="Toggle navigation" onclick={() => menuOpen = !menuOpen}><Menu size={18} /></Button><span>Workspace <span class="muted">/</span> {$session?.manifest.ui.title ?? page.params.workspace}</span><span class="topbar-note"><span class="status-dot" data-status={$session ? 'live' : 'loading'}></span>{$session ? 'Signed in' : 'Connecting'}</span><Button variant="ghost" size="sm" href={navigation.homeHref}>← Back to app</Button></header>
    <main class="mx-auto w-full max-w-[1550px] flex-1 p-8 max-[1000px]:p-6 max-[700px]:px-4 max-[700px]:py-6">
      {#if error}<Card.Root><Card.Header><Card.Title>Unable to open workspace</Card.Title></Card.Header><Card.Content><p class="error" role="alert">{error}</p><Button href="/">Sign in</Button></Card.Content></Card.Root>
      {:else if $session}{@render children()}
      {:else}<div class="mb-7"><h1>Opening your workspace…</h1></div><div class="skeleton"></div>{/if}
    </main>
    <footer class="flex justify-between gap-5 px-8 py-4 text-xs text-muted-foreground max-[700px]:px-4 max-[700px]:[&>span:nth-child(2)]:hidden"><span>Workcore</span><span>SQLite-backed · server-authorised · live by default</span><span>Admin UI build {__ADMIN_BUILD_ID__}</span></footer>
  </div>
</div>
