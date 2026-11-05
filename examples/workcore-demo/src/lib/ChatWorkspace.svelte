<script lang="ts">
  import { untrack } from 'svelte';
  import type { Json, Run } from '@workcore/core';
  import type { TaskClient, NotesClient, Conversation, Message as ChatMessage } from './types';
  import { useLive } from './live.svelte';
  import ChatAttachment from './ChatAttachment.svelte';
  import Markdown from './Markdown.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Badge } from '$lib/components/ui/badge';
  import * as MessageScroller from '$lib/components/ui/message-scroller';
  import * as Message from '$lib/components/ui/message';
  import * as Bubble from '$lib/components/ui/bubble';
  import { ArrowUp, Square, Copy, Check, Sparkles, LoaderCircle, History } from '@lucide/svelte';
  let {
    taskClient,
    noteClient,
    conversation,
    userId,
  }: {
    taskClient: TaskClient;
    noteClient: NotesClient;
    conversation: import('@workcore/client').LiveState<Conversation>;
    userId: string;
  } = $props();
  let prompt = $state(''),
    busy = $state(false),
    error = $state(''),
    pendingId = $state<string | null>(null),
    copied = $state('');
  let turns = $state<ChatMessage[]>([]),
    cursor = $state<Conversation['nextCursor']>(null),
    historyLoaded = false,
    loadingHistory = $state(false);
  const runId = $derived(pendingId ?? conversation.data?.runId);
  const run = useLive<Json>((listener) =>
    runId ? taskClient.subscribeSystem('runs.inspect', { runId }, listener) : undefined,
  );
  const runData = $derived(run.state.data as unknown as Run | undefined);
  const running = $derived(
    busy ||
      (!!pendingId && run.state.status === 'loading') ||
      ['queued', 'running'].includes(runData?.status ?? ''),
  );
  const progress = $derived(
    runData?.progress as
      { phase?: string; tool?: string; text?: string; turn?: number } | undefined,
  );
  const runError = $derived(
    runData?.status === 'failed' ? (runData.error ?? 'Assistant could not finish.') : '',
  );
  $effect(() => {
    const data = conversation.data;
    if (!data) return;
    untrack(() => {
      const merged = new Map(turns.map((m) => [m.id, m]));
      for (const message of data.messages) merged.set(message.id, message);
      turns = [...merged.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      if (!historyLoaded) cursor = data.nextCursor;
    });
  });
  $effect(() => {
    if (runData && ['completed', 'failed', 'cancelled'].includes(runData.status)) pendingId = null;
  });
  async function loadOlder() {
    if (!cursor || loadingHistory) return;
    loadingHistory = true;
    error = '';
    const before = cursor;
    try {
      const result = await taskClient.query('conversationHistory', { before });
      const merged = new Map([...result.data.messages, ...turns].map((m) => [m.id, m]));
      turns = [...merged.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      cursor = result.data.nextCursor;
      historyLoaded = true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load history';
    } finally {
      loadingHistory = false;
    }
  }
  async function send(text = prompt) {
    const message = text.trim();
    if (!message || running) return;
    busy = true;
    error = '';
    prompt = '';
    try {
      const result = await taskClient.mutate('sendMessage', { message });
      pendingId = result.data.runId;
    } catch (e) {
      prompt = message;
      error = e instanceof Error ? e.message : 'Could not send message';
    } finally {
      busy = false;
    }
  }
  async function cancel() {
    if (!runId) return;
    try {
      await taskClient.control('run', runId, 'cancel');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not cancel run';
    }
  }
  async function copy(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      copied = message.id;
    } catch {
      error = 'Clipboard is unavailable in this browser.';
    }
  }
</script>

<section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Workspace chat">
  <MessageScroller.Provider autoScroll>
    <div class="min-h-0 flex-1">
      <MessageScroller.Root>
        {#if cursor}<div class="flex shrink-0 justify-center border-b bg-card py-2">
            <Button variant="outline" size="sm" disabled={loadingHistory} onclick={loadOlder}>
              <History class="size-3.5" />{loadingHistory ? 'Loading…' : 'Load older messages'}
            </Button>
          </div>{/if}
        <MessageScroller.Viewport>
          <MessageScroller.Content class="mx-auto w-full max-w-3xl gap-6 px-4 py-6 md:px-6">
            {#if conversation.status === 'error'}<p role="alert" class="text-destructive">
                {conversation.error?.message}
              </p>{/if}
            {#if !turns.length}<div class="my-auto py-12">
                <div
                  class="mb-4 flex size-10 items-center justify-center rounded-xl border bg-card text-primary"
                >
                  <Sparkles class="size-5" />
                </div>
                <h1 class="text-2xl font-semibold tracking-tight">A little more room to think.</h1>
                <p class="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  Manage tasks and private notes in one conversation. Bring live lists into chat,
                  then work with them directly.
                </p>
                <div class="mt-5 flex flex-wrap gap-2">
                  {#each ['Show my open tasks', 'Show my notes', 'Create a task to review the launch'] as suggestion}<Button
                      variant="outline"
                      size="sm"
                      class="h-auto whitespace-normal py-2 text-left"
                      onclick={() => send(suggestion)}
                      disabled={running}
                    >
                      {suggestion}
                    </Button>{/each}
                </div>
              </div>{/if}
            {#each turns as turn (turn.id)}<MessageScroller.Item
                messageId={turn.id}
                class="chat-message"
                data-message-id={turn.id}
              >
                <Message.Root align={turn.role === 'user' ? 'end' : 'start'}>
                  <Message.Content class="min-w-0 max-w-full gap-2">
                    <Message.Header class="text-[11px] text-muted-foreground">
                      <span class="font-medium">{turn.role === 'user' ? 'You' : 'Assistant'}</span>
                      <time datetime={new Date(turn.at).toISOString()}>
                        {new Date(turn.at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </Message.Header>
                    <Bubble.Root
                      variant={turn.role === 'user' ? 'tinted' : 'ghost'}
                      class={turn.role === 'user' ? 'max-w-[90%]' : 'w-full max-w-full'}
                    >
                      <Bubble.Content><Markdown text={turn.content} /></Bubble.Content>
                    </Bubble.Root>
                    {#each turn.parts as part, index (index)}{#if part.type !== 'text'}<ChatAttachment
                          {part}
                          {taskClient}
                          {noteClient}
                          {userId}
                        />{/if}{/each}
                  </Message.Content>
                </Message.Root>
              </MessageScroller.Item>{/each}
            {#if running}<MessageScroller.Item messageId="pending">
                <div
                  class="rounded-lg border bg-card p-3"
                  role="status"
                  aria-label="Assistant progress"
                >
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    <LoaderCircle class="size-3.5 animate-spin" />{progress?.phase === 'tool'
                      ? `Using ${progress.tool ?? 'a tool'}…`
                      : progress?.phase === 'streaming'
                        ? 'Writing…'
                        : 'Assistant is working…'}{#if progress?.turn}<Badge
                        variant="secondary"
                        class="ml-auto text-[10px]"
                      >
                        Step {progress.turn}
                      </Badge>{/if}
                  </div>
                  {#if progress?.text}<div class="mt-2 text-sm text-muted-foreground">
                      <Markdown text={progress.text} />
                    </div>{/if}
                </div>
              </MessageScroller.Item>{/if}
          </MessageScroller.Content>
        </MessageScroller.Viewport><MessageScroller.Button />
      </MessageScroller.Root>
    </div>
    <div class="shrink-0 border-t bg-card px-4 py-3 md:px-6">
      <div class="mx-auto max-w-3xl">
        {#if error || runError}<p class="mb-2 text-sm text-destructive" role="alert">
            {error || runError}
          </p>{/if}{#if runData?.status === 'cancelled'}<p
            class="mb-2 text-xs text-muted-foreground"
          >
            Stopped. Completed actions remain saved.
          </p>{/if}
        <form
          class="rounded-xl border bg-background p-2 shadow-xs focus-within:ring-2 focus-within:ring-ring/30"
          onsubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            aria-label="Message"
            bind:value={prompt}
            class="min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            rows={2}
            maxlength={4000}
            placeholder="Ask about work, or capture an idea…"
            onkeydown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div class="flex items-center justify-between px-1">
            <p class="text-[11px] text-muted-foreground">
              Enter to send · Shift + Enter for a new line
            </p>
            {#if running}<Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Stop assistant"
                onclick={cancel}
              >
                <Square class="size-3.5" />
              </Button>{:else}<Button
                type="submit"
                size="icon-sm"
                aria-label="Send message"
                disabled={!prompt.trim()}
              >
                <ArrowUp class="size-4" />
              </Button>{/if}
          </div>
        </form>
        <p class="mt-2 text-center text-[10px] text-muted-foreground">
          Live cards reflect current data. Messages preserve the conversation.
        </p>
      </div>
    </div>
  </MessageScroller.Provider>
</section>
