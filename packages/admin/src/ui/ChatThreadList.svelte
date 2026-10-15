<script lang="ts">
  import type { ChatAction, ChatActionMapping, ChatActor, ChatThread } from '@workcore/core';
  import { richJson } from './rich-input.js';

  let { threads = [], actionMappings = {}, onAction } = $props<{
    threads?: ChatThread[];
    actionMappings?: Partial<Record<'editMessage' | 'deleteMessage' | 'createThread' | 'renameThread' | 'archiveThread' | 'retryAgent', ChatActionMapping>>;
    onAction?: (action: ChatAction, mapping: ChatActionMapping) => void;
  }>();
</script>

<div class="chat-thread-list">
  {#if !threads.length}<div class="empty"><p>No matching threads.</p></div>{/if}
  {#each threads as thread (thread.id)}
    <article class="chat-thread-row">
      <div>
        <strong>{thread.title ?? thread.id}</strong>
        <span class="status">{thread.status ?? 'open'}</span>
        <p>{thread.lastMessage?.preview ?? thread.lastMessage?.id ?? thread.description ?? ''}</p>
        <small>{thread.participants?.map((person: ChatActor) => person.name ?? person.id).join(', ') ?? ''} · {thread.messageCount ?? 0} messages</small>
      </div>
      <details><summary>Thread data</summary><pre>{richJson(thread)}</pre></details>
      {#if thread.actions?.length}
        <div class="chat-actions">
          {#each thread.actions as action (action.id)}
            {@const mapping = actionMappings[action.id as keyof typeof actionMappings]}
            {#if mapping}<button class="secondary" disabled={action.disabled} title={action.disabledReason ?? action.confirm} onclick={() => onAction?.(action, mapping)}>{action.label}</button>{/if}
          {/each}
        </div>
      {/if}
    </article>
  {/each}
</div>
