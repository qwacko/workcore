import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Engine } from '../packages/core/src/engine';
import { tracker } from '../examples/workcore-demo/src/app';
import { notesApp } from '../examples/workcore-demo/src/notes';
import { chatPartSchema, readChatParts } from '../examples/workcore-demo/src/chat-contract';

const alice = { id: 'alice' },
  bob = { id: 'bob' };
const bindings = env as unknown as { TEST: DurableObjectNamespace };
async function inStorage(fn: (state: DurableObjectState) => Promise<void>) {
  await runInDurableObject(
    bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())),
    async (_instance, state) => fn(state),
  );
}

describe('application-owned chat contracts', () => {
  it('accepts typed data references, rejects layout definitions and safely reads old history', () => {
    expect(chatPartSchema.parse({ type: 'task-list' })).toEqual({
      type: 'task-list',
      projectId: 'inbox',
      status: 'open',
    });
    expect(
      chatPartSchema.safeParse({
        type: 'display',
        display: 'arbitrary',
        input: {},
      }).success,
    ).toBe(false);
    expect(
      chatPartSchema.safeParse({
        type: 'note',
        noteId: 'one',
        html: '<script>',
      }).success,
    ).toBe(false);
    expect(
      readChatParts(
        JSON.stringify([
          { type: 'display', display: 'chatNotes', input: { query: 'launch' } },
          {
            type: 'display',
            display: 'savedDisplay',
            input: { savedDisplayId: 'old' },
          },
          { type: 'text', text: 'Your old page' },
        ]),
      ),
    ).toEqual([
      { type: 'note-list', query: 'launch', starredOnly: false },
      { type: 'text', text: 'Your old page' },
    ]);
    expect(readChatParts('broken')).toEqual([]);
  });
  it('paginates beyond 200 messages without duplicates, including equal timestamps, and isolates identities', async () => {
    await inStorage(async (state) => {
      const engine = new Engine(state.storage, tracker, {});
      for (let i = 0; i < 205; i++)
        engine.mutate(
          alice,
          'appendChatTurn',
          { role: 'user', content: `Message ${i}` },
          `message-${i}`,
        );
      state.storage.sql.exec('UPDATE messages SET at = 1');
      const tail = engine.query(alice, 'conversation', {}).data as any;
      expect(tail.messages).toHaveLength(40);
      expect(tail.nextCursor).toBeTruthy();
      const messages = [...tail.messages];
      let before = tail.nextCursor;
      while (before) {
        const page = engine.query(alice, 'conversationHistory', {
          before,
          limit: 31,
        }).data as any;
        messages.unshift(...page.messages);
        before = page.nextCursor;
      }
      expect(messages).toHaveLength(205);
      expect(new Set(messages.map((m) => m.id)).size).toBe(205);
      expect(messages.map((m) => m.id)).toEqual(messages.map((m) => m.id).sort());
      expect(engine.query(bob, 'conversation', {}).data).toMatchObject({
        messages: [],
        nextCursor: null,
      });
      expect(
        engine.query(bob, 'conversationHistory', { before: tail.nextCursor }).data,
      ).toMatchObject({ messages: [], nextCursor: null });
      expect(() => engine.query(bob, 'agentHistory', { messageId: messages[0].id })).toThrow(
        'matching user message',
      );
      expect(engine.query(alice, 'agentHistory', { messageId: messages[0].id }).data).toHaveLength(
        1,
      );
    });
  });
  it('creates a task and persists a live data reference, with no display-authoring operations', async () => {
    await inStorage(async (state) => {
      const engine = new Engine(state.storage, tracker, {
        WORKCORE_AI_MODE: 'demo',
      });
      const queued = engine.mutate(
        alice,
        'sendMessage',
        { message: 'Create a task to check live cards' },
        'create',
      ).data as any;
      await engine.executeNext();
      expect(engine.inspect(alice, `run:${queued.runId}`)).toMatchObject({
        status: 'completed',
      });
      const conversation = engine.query(alice, 'conversation', {}).data as any;
      const reply = conversation.messages.at(-1);
      expect(reply.parts).toEqual([{ type: 'task', taskId: expect.any(String) }]);
      expect(
        engine.query(alice, 'taskDetails', { taskId: reply.parts[0].taskId }).data,
      ).toMatchObject({
        title: 'check live cards',
        ownerId: 'alice',
        private: true,
      });
      expect(engine.query(bob, 'taskDetails', { taskId: reply.parts[0].taskId }).data).toBeNull();
      expect(Object.keys(tracker.mutations)).not.toContain('createSavedDisplayDraft');
      expect(Object.keys(tracker.queries)).not.toContain('displayCatalogue');
    });
  });
  it('checks note access again when resolving a single attachment', async () => {
    await inStorage(async (state) => {
      const engine = new Engine(state.storage, notesApp, {});
      const note = engine.mutate(alice, 'create', { title: 'Private', body: 'My note' }, 'note')
        .data as any;
      expect(engine.query(alice, 'details', { noteId: note.id }).data).toMatchObject({
        title: 'Private',
      });
      expect(engine.query(bob, 'details', { noteId: note.id }).data).toBeNull();
    });
  });
});
