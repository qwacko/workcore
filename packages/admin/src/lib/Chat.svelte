<script lang="ts">
  import { getContext, tick } from 'svelte';
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { LiveState } from '@workcore/client';
  import { date, readPath, text } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import Markdown from './Markdown.svelte';
  import AgentProgress from './AgentProgress.svelte';
  let { block, data }: { block: ManifestBlock; data: Json } = $props();
  const session = getContext<SessionStore>(sessionKey);
  let prompt = $state('');
  let busy = $state(false);
  let error = $state('');
  let requestKey = '';
  let requestId = '';
  let transcript: HTMLDivElement;
  let run = $state<LiveState<Json>>({ status: 'loading', revision: 0 });
  const messages = $derived(readPath(data, block.messages ?? '') as unknown[] | undefined);
  const runId = $derived(block.runId ? readPath(data, block.runId) as string | null : null);
  const running = $derived(!!runId && (run.status === 'loading' || !!run.data && typeof run.data === 'object' && !Array.isArray(run.data) && ['queued', 'running'].includes(String(run.data.status))));
  $effect(() => { if ($session && runId) return $session.sources.watch({ kind: 'resource', name: `run:${runId}` }, {}, value => run = value); });
  $effect(() => {
    const count = messages?.length;
    if (count) void tick().then(() => { if (transcript) transcript.scrollTop = transcript.scrollHeight; });
  });
  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (!$session || !block.send || !block.promptField || !prompt.trim()) return;
    busy = true; error = '';
    try {
      const input = { ...block.send.values, [block.promptField]: prompt.trim() };
      const key = JSON.stringify(input);
      if (!requestId || requestKey !== key) { requestKey = key; requestId = crypto.randomUUID(); }
      if (block.send.operation.kind === 'mutation') await $session.client.mutate(block.send.operation.name, input, requestId);
      else await $session.client.enqueue(block.send.operation.name, input, requestId);
      requestId = '';
      prompt = ''; $session.sources.refresh();
    } catch (failure) { error = failure instanceof Error ? failure.message : 'Message failed'; }
    finally { busy = false; }
  }
</script>
<div class="chat-thread" bind:this={transcript} role="log" aria-label="Conversation">
  {#if !messages?.length}<div class="empty"><strong>Start a conversation</strong><p>Ask about your tasks. Messages and replies are private to your identity.</p></div>{/if}
  {#each messages ?? [] as message (String(readPath(message, block.message?.id ?? 'id')))}
    <article class="chat-message" data-role={readPath(message, block.message?.role ?? 'role')}>
      <div class="message-meta"><strong>{readPath(message, block.message?.role ?? 'role') === 'user' ? 'You' : 'Assistant'}</strong>{#if block.message?.at}<time>{date(readPath(message, block.message.at))}</time>{/if}</div>
      <Markdown content={readPath(message, block.message?.content ?? 'content')} />
    </article>
  {/each}
</div>
{#if runId && $session}
  {#if run.data && typeof run.data === 'object' && !Array.isArray(run.data) && run.data.progress}<AgentProgress value={run.data.progress} status={run.data.status} />{/if}
  <div class="chat-execution" role="status"><span class:working={running}>{run.data && typeof run.data === 'object' && !Array.isArray(run.data) ? text(run.data.status) : 'Checking execution…'}</span><a href={`/admin/${$session.workspace}/runs/${runId}`}>Inspect run →</a></div>
  {#if run.data && typeof run.data === 'object' && !Array.isArray(run.data) && run.data.error}<p class="error">{text(run.data.error)}</p>{/if}
{/if}
{#if block.send}
  <form class="chat-composer" onsubmit={send}>
    <label class="sr-only" for={`prompt-${block.id}`}>Message</label>
    <textarea id={`prompt-${block.id}`} bind:value={prompt} placeholder="Ask your workspace assistant…" rows="2" maxlength="4000" disabled={busy || !!running}></textarea>
    <button class="primary" disabled={busy || !!running || !prompt.trim()}>{busy ? 'Sending…' : 'Send message'}</button>
  </form>
{:else}<p class="help">Read-only conversation. You do not have permission to send messages.</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
<p class="help">Replies execute in the background. You can leave this page and return; this is persisted chat, not token streaming.</p>
