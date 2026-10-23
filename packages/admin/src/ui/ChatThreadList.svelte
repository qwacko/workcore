<script lang="ts">
  import type { ChatAction, ChatActionMapping, ChatActor, ChatThread } from '@workcore/core';
  import { richJson } from './rich-input.js';

  let { threads = [], actionMappings = {}, searchValue = '', searchEnabled = true, nextCursor = null, onAction, onSearch, onSelect, onLoadMore } = $props<{
    threads?: ChatThread[];
    actionMappings?: Record<string, ChatActionMapping>;
    searchValue?: string;
    searchEnabled?: boolean;
    nextCursor?: string | null;
    onAction?: (action: ChatAction, mapping: ChatActionMapping) => void;
    onSearch?: (value: string) => void;
    onSelect?: (thread: ChatThread) => void;
    onLoadMore?: (cursor: string) => Promise<{ items: ChatThread[]; nextCursor: string | null }>;
  }>();
  let draft = $state('');
  let extraThreads = $state<ChatThread[]>([]);
  let extraCursor = $state<string | null>(null);
  let hasLoadedMore = $state(false);
  let loadingMore = $state(false);
  let loadError = $state('');
  $effect(() => {
    const currentThreads = threads;
    const currentCursor = nextCursor;
    draft = searchValue;
    extraThreads = [];
    extraCursor = null;
    hasLoadedMore = false;
    void currentThreads;
    void currentCursor;
  });
  const allThreads = $derived([...threads, ...extraThreads].filter((thread, index, rows) => rows.findIndex((candidate) => candidate.id === thread.id) === index));

  async function loadMore() {
    const cursor = hasLoadedMore ? extraCursor : nextCursor;
    if (!cursor || !onLoadMore || loadingMore) return;
    loadingMore = true;
    loadError = '';
    try {
      const page = await onLoadMore(cursor);
      extraThreads = [...extraThreads, ...page.items];
      hasLoadedMore = true;
      extraCursor = page.nextCursor && page.nextCursor !== cursor ? page.nextCursor : null;
    } catch (cause) { loadError = cause instanceof Error ? cause.message : 'Could not load more threads.'; }
    finally { loadingMore = false; }
  }
</script>

<div class="chat-thread-list">
  {#if searchEnabled}<form class="chat-thread-search" onsubmit={(event) => { event.preventDefault(); onSearch?.(draft); }}><input aria-label="Search threads" bind:value={draft} placeholder="Search threads…" /><button class="secondary" type="submit">Search</button></form>{/if}
  {#if !allThreads.length}<div class="empty"><p>No matching threads.</p></div>{/if}
  {#each allThreads as thread (thread.id)}
    <article class="chat-thread-row">
      <button class="chat-thread-select" type="button" onclick={() => onSelect?.(thread)}>
        <strong>{thread.title ?? thread.id}</strong>
        <span class="status">{thread.status ?? 'open'}</span>
        <p>{thread.lastMessage?.preview ?? thread.lastMessage?.id ?? thread.description ?? ''}</p>
        <small>{thread.participants?.map((person: ChatActor) => person.name ?? person.id).join(', ') ?? ''} · {thread.messageCount ?? 0} messages</small>
      </button>
      <details><summary>Thread data</summary><pre>{richJson(thread)}</pre></details>
      {#if thread.actions?.length}<div class="chat-actions">{#each thread.actions as action (action.id)}{@const mapping = actionMappings[action.id]}{#if mapping}<button class="secondary" disabled={action.disabled} title={action.disabledReason ?? action.confirm} onclick={() => onAction?.(action, mapping)}>{action.label}</button>{/if}{/each}</div>{/if}
    </article>
  {/each}
  {#if loadError}<p class="schema-hint" role="status">{loadError}</p>{/if}
  {#if hasLoadedMore ? extraCursor : nextCursor}<button class="secondary" type="button" onclick={() => void loadMore()} disabled={loadingMore || !onLoadMore}>{loadingMore ? 'Loading…' : 'Load more threads'}</button>{/if}
</div>

<style>
  .chat-thread-search { display: flex; gap: .5rem; margin-bottom: .75rem; }
  .chat-thread-search input { min-width: 0; flex: 1; }
  .chat-thread-row { display: flex; align-items: flex-start; gap: .75rem; justify-content: space-between; }
  .chat-thread-select { min-width: 0; flex: 1; border: 0; padding: 0; text-align: left; color: inherit; background: transparent; cursor: pointer; }
  .chat-thread-select:hover strong { text-decoration: underline; }
</style>
