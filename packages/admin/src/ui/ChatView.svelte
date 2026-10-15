<script lang="ts">
  import type { ChatAction, ChatActionMapping, ChatMessage, UiVariant } from '@workcore/core';
  import ChatTimeline from './ChatTimeline.svelte';
  import ChatThreadList from './ChatThreadList.svelte';
  import { activeRuns, chatMessages, chatThreads, chatTimelineKey, previousCursor } from './chat-data.js';

  let { variant, result, contextKey, inputText = '{}', sending = false, followToken = 0, onSend, onAction, onLoadOlder } = $props<{
    variant: UiVariant;
    result: unknown;
    contextKey: string;
    inputText?: string | undefined;
    sending?: boolean | undefined;
    followToken?: number | undefined;
    onSend?: ((text: string) => Promise<void>) | undefined;
    onAction?: ((action: ChatAction, mapping: ChatActionMapping) => void) | undefined;
    onLoadOlder?: ((cursor: string) => Promise<{ messages: ChatMessage[]; previousCursor: string | null }>) | undefined;
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
  <ChatThreadList threads={chatThreads(result)} actionMappings={mappings} {onAction} />
{:else if variant.renderer === 'chat-thread'}
  {@const thread = chatThreads(result)[0]}
  {#if thread}
    <section class="chat-panel" aria-label="Thread detail">
      <ChatThreadList threads={[thread]} actionMappings={mappings} {onAction} />
      <ChatTimeline messages={chatMessages(result)} previousCursor={previousCursor(result)} autoScroll={variant.chat?.autoScroll ?? 'when-near-bottom'} {followToken} {resetKey} actionMappings={mappings} {onAction} {onLoadOlder} emptyMessage="No messages in this thread." />
    </section>
  {:else}<div class="empty"><p>Thread not found.</p></div>{/if}
{:else}
  <section class="chat-panel" aria-label={variant.renderer === 'chat' ? 'Conversation' : 'Messages'}>
    <ChatTimeline messages={chatMessages(result)} previousCursor={previousCursor(result)} autoScroll={variant.chat?.autoScroll ?? 'when-near-bottom'} {followToken} {resetKey} activeRuns={activeRuns(result)} actionMappings={mappings} {onAction} {onLoadOlder} emptyMessage={variant.renderer === 'chat' ? 'No messages in this conversation yet.' : 'No matching messages.'} />
    {#if variant.renderer === 'chat' && variant.chat && onSend}
      <form class="chat-composer" onsubmit={send}>
        <textarea aria-label="Message" bind:value={draft} rows="3" placeholder="Write a message…" disabled={sending}></textarea>
        <button class="primary" type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send message'}</button>
      </form>
    {:else if variant.renderer === 'chat'}<p class="schema-hint">Message sending is not authorized for this actor.</p>{/if}
  </section>
{/if}
