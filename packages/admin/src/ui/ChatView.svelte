<script lang="ts">
  import type { ChatAction, ChatActionMapping, ChatMessage, ChatThread, OperationViewVariant } from '@workcore/core';
  import ChatTimeline from './ChatTimeline.svelte';
  import ChatThreadList from './ChatThreadList.svelte';
  import { activeRuns, chatMessages, chatThreads, chatTimelineKey, nextCursor, pathValue, previousCursor } from './chat-data.js';
  import { parseEditableJson } from './rich-input.js';

  let { variant, result, contextKey, inputText = '{}', sending = false, followToken = 0, cacheNamespace = 'default', onSend, onAction, onLoadOlder, onQueryView, onNavigate, onThreadSearch, onThreadSelect, onLoadMoreThreads } = $props<{
    variant: OperationViewVariant;
    result: unknown;
    contextKey: string;
    inputText?: string | undefined;
    sending?: boolean | undefined;
    followToken?: number | undefined;
    cacheNamespace?: string | undefined;
    onSend?: ((text: string) => Promise<void>) | undefined;
    onAction?: ((action: ChatAction, mapping: ChatActionMapping) => void) | undefined;
    onLoadOlder?: ((cursor: string) => Promise<{ items: ChatMessage[]; previousCursor: string | null }>) | undefined;
    onQueryView?: ((query: string, view: string | undefined, input: unknown) => Promise<unknown>) | undefined;
    onNavigate?: ((page: string, state: Record<string, string>) => void) | undefined;
    onThreadSearch?: ((value: string) => void) | undefined;
    onThreadSelect?: ((thread: ChatThread) => void) | undefined;
    onLoadMoreThreads?: ((cursor: string) => Promise<{ items: ChatThread[]; nextCursor: string | null }>) | undefined;
  }>();
  let draft = $state('');
  let previousContext: string | undefined;
  let draftGeneration = 0;
  $effect(() => {
    if (contextKey !== previousContext) {
      previousContext = contextKey;
      draftGeneration++;
      draft = '';
    }
  });
  const resetKey = $derived(chatTimelineKey(contextKey, inputText, result, variant));
  const mappings = $derived(variant.chatActions ?? variant.chat?.actions ?? {});
  const threadSearch = $derived.by(() => {
    try { return String(pathValue(parseEditableJson(inputText || '{}'), variant.chatList?.searchInput ?? 'search') ?? ''); }
    catch { return ''; }
  });

  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (!draft.trim() || sending || !onSend) return;
    const text = draft;
    const requestKey = resetKey;
    const requestGeneration = draftGeneration;
    draft = '';
    try { await onSend(text); }
    catch { if (requestGeneration === draftGeneration && requestKey === resetKey && !draft) draft = text; }
  }
</script>

  {#if variant.renderer === 'chat-threads'}
  <ChatThreadList threads={chatThreads(result)} actionMappings={mappings} searchValue={threadSearch} searchEnabled={!!variant.chatList?.searchInput || !!onThreadSearch} nextCursor={nextCursor(result)} {onAction} onSearch={onThreadSearch} onSelect={variant.chatList?.threadQuery ? onThreadSelect : undefined} onLoadMore={onLoadMoreThreads} />
{:else if variant.renderer === 'chat-thread'}
  {@const thread = chatThreads(result)[0]}
  {#if thread}
    <section class="chat-panel" aria-label="Thread detail">
      <ChatThreadList threads={[thread]} actionMappings={mappings} searchEnabled={false} {onAction} onSelect={onThreadSelect} />
        <ChatTimeline messages={chatMessages(result)} previousCursor={previousCursor(result)} autoScroll={variant.chat?.autoScroll ?? 'when-near-bottom'} {followToken} {resetKey} {cacheNamespace} actionMappings={mappings} {onAction} {onLoadOlder} {onQueryView} {onNavigate} emptyMessage="No messages in this thread." />
      {#if variant.chat?.sendMutation && variant.chat.messageInput && onSend}
        <form class="chat-composer" onsubmit={send}>
          <textarea aria-label="Message" bind:value={draft} rows={variant.chat.rows ?? 3} placeholder={variant.chat.placeholder ?? 'Write a message…'} disabled={sending}></textarea>
          <button class="primary" type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : variant.chat.submitLabel ?? 'Send message'}</button>
        </form>
      {:else if variant.chat?.sendMutation && variant.chat.messageInput}<p class="schema-hint">Message sending is not authorized for this actor.</p>{/if}
    </section>
  {:else}<div class="empty"><p>Thread not found.</p></div>{/if}
{:else}
  <section class="chat-panel" aria-label={variant.renderer === 'chat' ? 'Conversation' : 'Messages'}>
    <ChatTimeline messages={chatMessages(result)} previousCursor={previousCursor(result)} autoScroll={variant.chat?.autoScroll ?? 'when-near-bottom'} {followToken} {resetKey} {cacheNamespace} activeRuns={activeRuns(result)} actionMappings={mappings} {onAction} {onLoadOlder} {onQueryView} {onNavigate} emptyMessage={variant.renderer === 'chat' ? 'No messages in this conversation yet.' : 'No matching messages.'} />
    {#if variant.chat?.sendMutation && variant.chat.messageInput && onSend}
      <form class="chat-composer" onsubmit={send}>
        <textarea aria-label="Message" bind:value={draft} rows={variant.chat.rows ?? 3} placeholder={variant.chat.placeholder ?? 'Write a message…'} disabled={sending}></textarea>
        <button class="primary" type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : variant.chat.submitLabel ?? 'Send message'}</button>
      </form>
    {:else if variant.chat?.sendMutation && variant.chat.messageInput}<p class="schema-hint">Message sending is not authorized for this actor.</p>{/if}
  </section>
{/if}
