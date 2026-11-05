<script lang="ts">
  import { getContext, tick } from 'svelte';
  import type { Json, ManifestBlock } from '@workcore/core';
  import { date, readPath, text } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import Markdown from './Markdown.svelte';
  import AgentProgress from './AgentProgress.svelte';
  import { useSource } from './source.svelte.js';
  import { useRendererHost } from './host-context.svelte.js';
  import { Textarea } from './components/ui/textarea/index.js';
  import { Button } from './components/ui/button/index.js';
  import * as Message from './components/ui/message/index.js';
  import EmptyState from './EmptyState.svelte';
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
  <div class="max-h-[430px] overflow-auto flex flex-col gap-3.5 px-1 py-0.5 pb-3" bind:this={transcript} role="log" aria-label="Conversation">
  {#if !messages?.length}<EmptyState title="Start a conversation" description="Ask about your tasks. Messages and replies are private to your identity." />{/if}
  {#each messages ?? [] as message (String(readPath(message, block.message?.id ?? 'id')))}
    {@const isUser = readPath(message, block.message?.role ?? 'role') === 'user'}
    <Message.Root align={isUser ? 'end' : 'start'} class="max-w-[90%] max-[700px]:max-w-[96%]">
      <Message.Content>
        <Message.Header class="flex w-full items-center gap-3 text-xs"><strong>{isUser ? 'You' : 'Assistant'}</strong>{#if block.message?.at}<time class="ml-auto">{date(readPath(message, block.message.at))}</time>{/if}</Message.Header>
        <div class="rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-sm">
          {#if block.message?.content}<Markdown content={text(readPath(message, block.message.content))} />{:else if block.message?.parts && Array.isArray(readPath(message, block.message.parts))}
            {#each readPath(message, block.message.parts) as part}
              {#if part && typeof part === 'object' && !Array.isArray(part) && part.type === 'text'}<Markdown content={text(part.text)} />{/if}
            {/each}
          {/if}
        </div>
      </Message.Content>
    </Message.Root>
  {/each}
</div>
{#if runId && $session && $session.manifest.runs}
  {#if runLoader.data && typeof runLoader.data === 'object' && !Array.isArray(runLoader.data) && runLoader.data.progress}<AgentProgress value={runLoader.data.progress} status={runLoader.data.status} />{/if}
  <div class="flex justify-between gap-4 pt-3 text-xs capitalize text-muted-foreground" role="status"><span class:text-primary={running}>{runLoader.data && typeof runLoader.data === 'object' && !Array.isArray(runLoader.data) ? text(runLoader.data.status) : 'Checking execution…'}</span>{#if host.runHref}<Button variant="link" size="sm" href={host.runHref(runId)}>Inspect run →</Button>{/if}</div>
  {#if runLoader.data && typeof runLoader.data === 'object' && !Array.isArray(runLoader.data) && runLoader.data.error}<p class="error">{text(runLoader.data.error)}</p>{/if}
{:else if runId && $session}
  <div class="chat-execution" role="status">Execution status is unavailable for your current actor.</div>
{/if}
{#if block.send}
  <form class="chat-composer mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-end" onsubmit={send}>
    <label class="sr-only" for={`prompt-${block.id}`}>Message</label>
    <Textarea id={`prompt-${block.id}`} bind:value={prompt} placeholder="Ask your workspace assistant…" rows={2} maxlength={4000} disabled={busy || !!running} />
    <Button type="submit" disabled={busy || !!running || !prompt.trim()}>{busy ? 'Sending…' : 'Send message'}</Button>
  </form>
{:else}<p class="help">Read-only conversation. You do not have permission to send messages.</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
<p class="help">Replies execute in the background. You can leave this page and return; the application controls how messages and attachments are presented.</p>
