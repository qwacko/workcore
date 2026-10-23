<script lang="ts">
  import { tick } from 'svelte';
  import type { ChatAction, ChatActionMapping, ChatContentPart, ChatMessage } from '@workcore/core';
  import ChatQueryView from './ChatQueryView.svelte';
  import ChatLayout from './ChatLayout.svelte';
  import { safeChatUrl, safeMarkdown } from './chat-data.js';

  type OlderPage = { items: ChatMessage[]; previousCursor: string | null };
  let {
    messages = [],
    previousCursor = null,
    autoScroll = 'when-near-bottom',
    followToken = 0,
    resetKey = '',
    activeRuns = [],
    actionMappings = {},
    emptyMessage = 'No messages yet.',
    onLoadOlder,
    onAction,
    onQueryView,
    onNavigate,
    cacheNamespace = 'default',
  } = $props<{
    messages?: ChatMessage[];
    previousCursor?: string | null;
    autoScroll?: 'always' | 'when-near-bottom' | 'never';
    followToken?: number;
    resetKey?: string;
    activeRuns?: Array<{ runId: string; status: string }>;
    actionMappings?: Record<string, ChatActionMapping>;
    emptyMessage?: string;
    onLoadOlder?: (cursor: string) => Promise<OlderPage>;
    onAction?: (action: ChatAction, mapping: ChatActionMapping) => void;
    onQueryView?: (query: string, view: string | undefined, input: unknown) => Promise<unknown>;
    onNavigate?: (page: string, state: Record<string, string>) => void;
    cacheNamespace?: string;
  }>();

  let scrollNode = $state<HTMLDivElement>();
  let contentNode = $state<HTMLDivElement>();
  let loadedOlder = $state<ChatMessage[]>([]);
  let hasLoadedOlder = $state(false);
  let nextOlderCursor = $state<string | null>(null);
  let loadingOlder = $state(false);
  let olderError = $state('');
  let showJump = $state(false);
  let nearBottom = true;
  let shouldFollow = true;
  let lastFollowToken: number | undefined;
  let currentResetKey: string | undefined;
  let lastContentHeight = 0;
  let observer: ResizeObserver | undefined;
  let paginationGeneration = 0;

  function mergeMessages(...groups: ChatMessage[][]): ChatMessage[] {
    const order: string[] = [];
    const byId = new Map<string, ChatMessage>();
    for (const group of groups) for (const message of group) {
      if (!byId.has(message.id)) order.push(message.id);
      byId.set(message.id, message);
    }
    return order.map((id) => byId.get(id)!);
  }

  const timelineMessages = $derived(mergeMessages(loadedOlder, messages));

  function statusText(status: ChatMessage['status']) {
    if (typeof status === 'string') return status;
    return status?.activity ?? status?.delivery ?? '';
  }

  function isHidden(status: ChatMessage['status']) {
    const value = status as ChatMessage['status'] | 'deleted' | 'hidden';
    return value === 'deleted' || value === 'hidden'
      || (typeof value === 'object' && value !== null && (value.visibility === 'deleted' || value.visibility === 'hidden'));
  }

  function hiddenLabel(status: ChatMessage['status']) {
    const value = status as ChatMessage['status'] | 'deleted' | 'hidden';
    return (typeof value === 'object' && value !== null && value.visibility === 'deleted' || value === 'deleted')
      ? 'This message was deleted.' : 'This message is hidden.';
  }

  function messageSections(message: ChatMessage) {
    return message.sections?.length ? message.sections : [{ id: 'content', parts: message.parts ?? [] }];
  }

  function partRecord(part: ChatContentPart) {
    return part as { type: string; [key: string]: unknown };
  }

  function format(value: unknown) {
    try { return JSON.stringify(value, null, 2) ?? 'null'; }
    catch { return String(value); }
  }

  function scrollToLatest() {
    if (!scrollNode) return;
    scrollNode.scrollTop = scrollNode.scrollHeight;
    nearBottom = true;
    showJump = false;
  }

  function onScroll() {
    if (!scrollNode) return;
    nearBottom = scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 72;
    if (nearBottom) showJump = false;
    if (scrollNode.scrollTop < 84) void loadOlder();
  }

  function visibleAnchor() {
    if (!scrollNode) return undefined;
    const top = scrollNode.getBoundingClientRect().top;
    const message = [...scrollNode.querySelectorAll<HTMLElement>('[data-message-id]')]
      .find((element) => element.getBoundingClientRect().bottom > top);
    return message ? { id: message.dataset.messageId ?? '', top: message.getBoundingClientRect().top } : undefined;
  }

  async function loadOlder() {
    const cursor = nextOlderCursor;
    if (!cursor || !onLoadOlder || loadingOlder) return;
    const node = scrollNode;
    const requestResetKey = resetKey;
    const requestGeneration = ++paginationGeneration;
    const anchor = visibleAnchor();
    const oldHeight = node?.scrollHeight ?? 0;
    loadingOlder = true;
    olderError = '';
    try {
      const page = await onLoadOlder(cursor);
      if (requestResetKey !== resetKey || requestGeneration !== paginationGeneration) return;
      loadedOlder = mergeMessages(page.items, loadedOlder);
      hasLoadedOlder = true;
      nextOlderCursor = page.previousCursor && page.previousCursor !== cursor ? page.previousCursor : null;
      await tick();
      if (scrollNode) {
        if (anchor?.id) {
          const anchored = [...scrollNode.querySelectorAll<HTMLElement>('[data-message-id]')].find((element) => element.dataset.messageId === anchor.id);
          if (anchored) scrollNode.scrollTop += anchored.getBoundingClientRect().top - anchor.top;
          else scrollNode.scrollTop += scrollNode.scrollHeight - oldHeight;
        } else scrollNode.scrollTop += scrollNode.scrollHeight - oldHeight;
        nearBottom = scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 72;
      }
      lastContentHeight = contentNode?.scrollHeight ?? lastContentHeight;
    } catch (cause) {
      if (requestResetKey === resetKey && requestGeneration === paginationGeneration) olderError = cause instanceof Error ? cause.message : 'Could not load older messages.';
    } finally {
      if (requestGeneration === paginationGeneration) loadingOlder = false;
    }
  }

  $effect(() => {
    const key = resetKey;
    if (key !== currentResetKey) {
      currentResetKey = key;
      paginationGeneration++;
      loadingOlder = false;
      loadedOlder = [];
      hasLoadedOlder = false;
      nextOlderCursor = previousCursor;
      olderError = '';
      showJump = false;
      nearBottom = true;
      void tick().then(() => { if (autoScroll !== 'never') scrollToLatest(); });
    }
  });

  $effect(() => {
    const cursor = previousCursor;
    if (!hasLoadedOlder && !loadingOlder) nextOlderCursor = cursor;
  });

  $effect.pre(() => {
    // Reading these props makes same-ID edits/replacements participate in the
    // pre-update check; ResizeObserver below also catches layout-only growth.
    const currentMessages = messages;
    const token = followToken;
    const mode = autoScroll;
    const key = resetKey;
    void currentMessages;
    void key;
    const forceFollow = token !== lastFollowToken;
    shouldFollow = mode === 'always' || nearBottom || forceFollow;
    lastFollowToken = token;
    if (mode === 'never' && !forceFollow) shouldFollow = false;
    if (loadingOlder) shouldFollow = false;
    void tick().then(() => {
      if (shouldFollow && autoScroll !== 'never' && !loadingOlder) scrollToLatest();
    });
  });

  $effect(() => {
    const node = contentNode;
    if (!node || typeof ResizeObserver === 'undefined') return;
    observer?.disconnect();
    lastContentHeight = node.scrollHeight;
    observer = new ResizeObserver(() => {
      const height = node.scrollHeight;
      const grew = height > lastContentHeight;
      lastContentHeight = height;
      if (!grew || loadingOlder) return;
      if (autoScroll === 'always' || nearBottom) scrollToLatest();
      else showJump = true;
    });
    observer.observe(node);
    return () => { observer?.disconnect(); observer = undefined; };
  });
</script>

<div class="chat-timeline-wrap">
  <div class="chat-messages" aria-live="polite" bind:this={scrollNode} onscroll={onScroll}>
    <div class="chat-timeline-content" bind:this={contentNode}>
      {#if nextOlderCursor}
        <button class="chat-load-older" type="button" onclick={() => void loadOlder()} disabled={loadingOlder}>{loadingOlder ? 'Loading older messages…' : 'Load older messages'}</button>
      {/if}
      {#if olderError}<p class="chat-live-note chat-load-error" role="status">{olderError}</p>{/if}
      {#each timelineMessages as message (message.id)}
        <article class="chat-message" data-message-id={message.id} class:user-message={message.role === 'user' || message.sender?.kind === 'person'}>
          <div class="chat-message-heading"><strong>{message.sender?.name ?? message.role ?? 'message'}</strong>{#if message.type}<span class="status">{message.type}</span>{/if}{#if statusText(message.status)}<span class="status" class:success={statusText(message.status) === 'complete' || statusText(message.status) === 'sent'}>{statusText(message.status)}</span>{/if}{#if message.runId}<small>Run {message.runId}</small>{/if}</div>
          {#if isHidden(message.status)}
            <p class="chat-text"><em>{hiddenLabel(message.status)}</em></p>
          {:else}
            {#each messageSections(message) as section (section.id)}
              <div class="chat-section">{#if section.title}<h3>{section.title}</h3>{/if}
                {#each section.parts as rawPart}
                  {@const part = partRecord(rawPart)}
                  {#if part.type === 'text'}<p class="chat-text">{String(part.text ?? '') || (statusText(message.status) === 'streaming' ? 'Assistant is thinking…' : '')}</p>
                  {:else if part.type === 'markdown'}<p class="chat-text chat-markdown">{@html safeMarkdown(String(part.content ?? ''))}</p>
                  {:else if part.type === 'image'}
                    {@const url = safeChatUrl(String(part.url ?? ''))}
                    <figure class="chat-attachment">{#if url}<img src={url} alt={String(part.alt ?? '')} loading="lazy" />{/if}<figcaption>{String(part.alt ?? '')}</figcaption></figure>
                  {:else if part.type === 'link'}
                    {@const url = safeChatUrl(String(part.url ?? ''))}
                    <p class="chat-text">{#if url}<a href={url} target="_blank" rel="noopener noreferrer">{String(part.label ?? part.url)}</a>{:else}{String(part.label ?? part.url ?? '')}{/if}</p>
                  {:else if part.type === 'file'}
                    {@const url = safeChatUrl(String(part.url ?? ''))}
                    <p class="chat-file">{#if url}<a href={url} target="_blank" rel="noopener noreferrer">{String(part.name ?? part.url)}</a>{:else}{String(part.name ?? part.url ?? '')}{/if}{#if part.mimeType}<small>{String(part.mimeType)}</small>{/if}</p>
                  {:else if part.type === 'navigation'}<button class="chat-navigation" type="button" disabled={!onNavigate} onclick={() => onNavigate?.(String(part.page), part.state && typeof part.state === 'object' ? part.state as Record<string, string> : {})}>{String(part.label ?? 'Open')}</button>
                  {:else if part.type === 'tool'}<details class="chat-tool"><summary>{String(part.name)} · {String(part.state)}</summary>{#if part.input !== undefined}<pre>{format(part.input)}</pre>{/if}{#if part.output !== undefined}<pre>{format(part.output)}</pre>{/if}</details>
                  {:else if part.type === 'queryView'}<ChatQueryView part={part as unknown as { query: string; view?: string; input?: unknown; title?: string }} cacheScope={resetKey} {cacheNamespace} load={onQueryView} />
                  {:else if part.type === 'customLayout'}<section class="chat-layout-block"><strong>{String(part.title ?? 'Custom layout')} · v{String(part.version)}</strong><ChatLayout layout={part.layout} version={Number(part.version)} /></section>
                  {:else}<details class="chat-tool"><summary>{String(part.type)} content</summary><pre>{format(rawPart)}</pre></details>{/if}
                {/each}
                {#if section.data !== undefined}<details class="chat-tool"><summary>Section data</summary><pre>{format(section.data)}</pre></details>{/if}
              </div>
            {/each}
            {#if message.actions?.length}<div class="chat-actions">{#each message.actions as action (action.id)}{@const mapping = actionMappings[action.id]}{#if mapping}<button class="secondary" disabled={action.disabled} title={action.disabledReason ?? action.confirm} onclick={() => onAction?.(action, mapping)}>{action.label}</button>{/if}{/each}</div>{/if}
            {#if message.data !== undefined}<details class="chat-tool"><summary>Message data</summary><pre>{format(message.data)}</pre></details>{/if}
          {/if}
        </article>
      {:else}<div class="empty"><p>{emptyMessage}</p></div>{/each}
      {#if activeRuns.length}<div class="active-chat-runs"><strong>Agent work in progress</strong>{#each activeRuns as run}<span>{run.status} · {run.runId}</span>{/each}</div>{/if}
    </div>
  </div>
  {#if showJump}<button class="chat-jump-latest" type="button" onclick={scrollToLatest}>New or updated messages · Jump to latest</button>{/if}
</div>
