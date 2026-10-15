<script lang="ts">
  import type { AdminBlock, ChatAction, ChatActionMapping, ChatMessage } from '@workcore/core';
  import type { UiMetadata } from '@workcore/client';
  import DataTable from './DataTable.svelte';
  import ChatView from './ChatView.svelte';
  import { richJson } from './rich-input.js';

  let { block, result, contextKey, error = '', loading = false, chatSending = false, followToken = 0, hasPreviousPage = false, variant, inputText = '{}', onRefresh, onInputChange, onPage, onOpen, onRowAction, onChatSend, onChatAction, onLoadOlder } = $props<{
    block: AdminBlock;
    contextKey: string;
    result?: unknown | undefined;
    error?: string | undefined;
    loading?: boolean | undefined;
    chatSending?: boolean | undefined;
    followToken?: number | undefined;
    hasPreviousPage?: boolean | undefined;
    variant?: UiMetadata['variants'][string] | undefined;
    inputText?: string | undefined;
    onRefresh?: (() => void) | undefined;
    onInputChange?: ((value: string) => void) | undefined;
    onPage?: ((cursor?: string) => void) | undefined;
    onOpen?: (() => void) | undefined;
    onRowAction?: ((row: Record<string, unknown>, action: NonNullable<UiMetadata['variants'][string]['actions']>[number]) => void) | undefined;
    onChatSend?: ((message: string) => Promise<void>) | undefined;
    onChatAction?: ((action: ChatAction, mapping: ChatActionMapping) => void) | undefined;
    onLoadOlder?: ((cursor: string) => Promise<{ messages: ChatMessage[]; previousCursor: string | null }>) | undefined;
  }>();

  function format(value: unknown) {
    return richJson(value);
  }

  function pageRows(value: unknown): Array<Record<string, unknown>> | undefined {
    if (!value || typeof value !== 'object' || !Array.isArray((value as { rows?: unknown }).rows)) return undefined;
    return (value as { rows: Array<Record<string, unknown>> }).rows;
  }

  function nextCursor(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const cursor = (value as { nextCursor?: unknown }).nextCursor;
    return typeof cursor === 'string' ? cursor : null;
  }

</script>

<section class="panel custom-block">
  {#if block.type === 'query'}
    <div class="panel-heading"><div><h2>{variant?.title ?? block.operation}</h2><p>{variant?.subtitle ?? block.variant ?? 'Query result'}</p></div><button class="text-button" onclick={onRefresh} disabled={loading}>{loading ? 'Running…' : variant?.renderer === 'chat' ? 'Check now' : 'Run query'}</button></div>
    {#if variant?.renderer !== 'chat'}<details class="dashboard-input"><summary>Query input (JSON)</summary><textarea aria-label={`Input for ${block.operation}`} value={inputText} oninput={(event) => onInputChange?.(event.currentTarget.value)} spellcheck="false" rows="4"></textarea><small>Validated by the query schema on the server.</small></details>{/if}
    {#if variant?.renderer.startsWith('chat')}
      {#if loading}<p class="chat-live-note">Updating…</p>{/if}
      {#if error}<div class="alert"><p>{error}</p></div>{/if}
      <ChatView {variant} {result} {contextKey} {inputText} sending={chatSending} {followToken} onSend={onChatSend} onAction={onChatAction} {onLoadOlder} />
      {#if variant.renderer === 'chat-threads' && (nextCursor(result) || hasPreviousPage)}<div class="pagination"><button class="secondary" onclick={() => onPage?.()} disabled={!hasPreviousPage || loading}>Previous</button><button class="secondary" onclick={() => onPage?.(nextCursor(result) ?? undefined)} disabled={!nextCursor(result) || loading}>Next</button></div>{/if}
    {:else if loading}<div class="empty"><p>Loading…</p></div>
    {:else if error}<div class="alert"><p>{error}</p></div>
    {:else if variant?.renderer === 'table' && pageRows(result)}
      {@const rows = pageRows(result)!}
      {@const columns = variant.columns?.length ? variant.columns : Object.keys(rows[0] ?? {})}
       <DataTable {rows} {columns} actions={variant.actions ?? []} onAction={onRowAction} />
       {#if nextCursor(result) || hasPreviousPage}<div class="pagination"><button class="secondary" onclick={() => onPage?.()} disabled={!hasPreviousPage || loading}>Previous</button><button class="secondary" onclick={() => onPage?.(nextCursor(result) ?? undefined)} disabled={!nextCursor(result) || loading}>Next</button></div>{/if}
    {:else if result !== undefined}<pre class="result">{format(result)}</pre>
    {:else}<div class="empty"><p>No result yet.</p></div>{/if}
  {:else if block.type === 'mutation-form'}
    <div class="panel-heading"><div><h2>{block.title ?? block.operation}</h2><p>Open the validated mutation form.</p></div><button class="primary" onclick={onOpen}>Open form</button></div>
  {:else if block.type === 'task-launcher'}
    <div class="panel-heading"><div><h2>{block.title ?? block.operation}</h2><p>Launch a validated background task.</p></div><button class="primary" onclick={onOpen}>Launch task</button></div>
  {:else}
    <div class="panel-heading"><div><h2>{block.title ?? block.resource}</h2><p>Open the built-in {block.resource} view.</p></div><button class="secondary" onclick={onOpen}>Open</button></div>
  {/if}
</section>
