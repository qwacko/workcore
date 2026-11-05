<script lang="ts">
  import { getContext, tick } from 'svelte';
  import type { Json, ManifestBlock } from '@workcore/core';
  import { date, readPath, text } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import Markdown from './Markdown.svelte';
  import AgentProgress from './AgentProgress.svelte';
  import { useSource } from './source.svelte.js';
  import { useRendererHost } from './host-context.svelte.js';
  let { block, data }: { block: Extract<ManifestBlock, { kind: 'chat' }>; data: Json } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const host = useRendererHost();
  let prompt = $state('');
  let busy = $state(false);
  let error = $state('');
  let transcript: HTMLDivElement;
  const messages = $derived(readPath(data, block.messages ?? '') as unknown[] | undefined);
  const runId = $derived(block.runId ? readPath(data, block.runId) as string | null : null);
  const runLoader = useSource(() => $session?.sources ?? null, () => runId && $session?.manifest.runs ? { kind: 'system', name: 'runs.inspect' } : null, () => ({ runId: runId ?? '' }));
  const running = $derived(!!runId && (runLoader.state.status === 'loading' || !!runLoader.data && typeof runLoader.data === 'object' && !Array.isArray(runLoader.data) && ['queued', 'running'].includes(String(runLoader.data.status))));
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
      await $session.actions.execute(`chat:${block.id}`, block.send.operation, input);
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
      {#if block.message?.content}<Markdown content={text(readPath(message, block.message.content))} />{:else if block.message?.parts && Array.isArray(readPath(message, block.message.parts))}
        {#each readPath(message, block.message.parts) as part}
          {#if part && typeof part === 'object' && !Array.isArray(part) && part.type === 'text'}<Markdown content={text(part.text)} />{/if}
        {/each}
      {/if}
    </article>
  {/each}
</div>
{#if runId && $session && $session.manifest.runs}
  {#if runLoader.data && typeof runLoader.data === 'object' && !Array.isArray(runLoader.data) && runLoader.data.progress}<AgentProgress value={runLoader.data.progress} status={runLoader.data.status} />{/if}
  <div class="chat-execution" role="status"><span class:working={running}>{runLoader.data && typeof runLoader.data === 'object' && !Array.isArray(runLoader.data) ? text(runLoader.data.status) : 'Checking execution…'}</span>{#if host.runHref}<a href={host.runHref(runId)}>Inspect run →</a>{/if}</div>
  {#if runLoader.data && typeof runLoader.data === 'object' && !Array.isArray(runLoader.data) && runLoader.data.error}<p class="error">{text(runLoader.data.error)}</p>{/if}
{:else if runId && $session}
  <div class="chat-execution" role="status">Execution status is unavailable for your current actor.</div>
{/if}
{#if block.send}
  <form class="chat-composer" onsubmit={send}>
    <label class="sr-only" for={`prompt-${block.id}`}>Message</label>
    <textarea id={`prompt-${block.id}`} bind:value={prompt} placeholder="Ask your workspace assistant…" rows="2" maxlength="4000" disabled={busy || !!running}></textarea>
    <button class="primary" disabled={busy || !!running || !prompt.trim()}>{busy ? 'Sending…' : 'Send message'}</button>
  </form>
{:else}<p class="help">Read-only conversation. You do not have permission to send messages.</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
<p class="help">Replies execute in the background. You can leave this page and return; the application controls how messages and attachments are presented.</p>
