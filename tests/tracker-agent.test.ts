import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../packages/core/src/engine.js';
import { tracker } from '../examples/tracker/src/app.js';

const alice = { id: 'alice' };
const bob = { id: 'bob' };
const bindings = env as unknown as { TEST: DurableObjectNamespace };
function chatResponse(content: string | null, tool?: { name: string; input: unknown }) {
  return new Response(JSON.stringify({
    id: crypto.randomUUID(), object: 'chat.completion', created: 1, model: 'test/model',
    choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: {
      role: 'assistant', content,
      ...(tool ? { tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } }] } : {}),
    } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { headers: { 'content-type': 'application/json' } });
}

describe('tracker agent application wiring', () => {
  it('uses the real SDK adapters, checked task tools, fallback and one atomic terminating reply', async () => {
    const requests: { url: string; body: any }[] = [];
    const reply = 'Created your private task.';
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      if (requests.length === 1) return chatResponse('I will do that.');
      if (requests.length === 2) return chatResponse(null, { name: 'createTask', input: { title: 'Created by SDK', private: true } });
      if (requests.length === 3) return new Response('Unavailable', { status: 503 });
      if (requests.length === 4) return chatResponse(null, { name: 'submitReply', input: { text: reply } });
      throw new Error('Unexpected extra model request');
    });
    try {
      await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
        const engine = new Engine(state.storage, tracker, {
          WORKCORE_AI_MODE: 'model', WORKCORE_AGENT_MODEL: 'openrouter/test/model', OPENROUTER_API_KEY: 'test-only-router-key',
          WORKCORE_AGENT_FALLBACK_MODEL: 'opencode/test-fallback', OPENCODE_API_KEY: 'test-only-backup-key',
        });
        engine.mutate(bob, 'createTask', { title: 'Bob secret context', private: true }, 'bob');
        const queued = engine.mutate(alice, 'sendMessage', { message: 'Create a private task titled Created by SDK.' }, 'chat').data as { runId: string };
        await engine.executeNext();
        expect(engine.inspect(alice, `run:${queued.runId}`)).toMatchObject({ status: 'completed', result: { text: reply }, progress: { turn: 3, fallbackAttempts: 1, completionMode: 'tool-required', completion: { kind: 'tool', tool: 'submitReply' }, usage: { totalTokens: 45 } } });
        const conversation = engine.query(alice, 'conversation', {}).data as { messages: { role: string; content: string }[] };
        expect(conversation.messages.map(message => [message.role, message.content])).toEqual([['user', 'Create a private task titled Created by SDK.'], ['assistant', reply]]);
        expect(engine.query(alice, 'assistantSummary', {}).data).toBe(reply);
        expect(engine.query(bob, 'conversation', {}).data).toMatchObject({ messages: [] });
        const history = engine.inspect(alice, 'history') as { rows: { operation: string }[] };
        expect(history.rows.filter(row => row.operation === 'mutation:saveReply')).toHaveLength(1);
        expect(history.rows.filter(row => row.operation === 'mutation:saveSummary')).toHaveLength(0);
        const tasks = engine.query(alice, 'myTaskPage', {}).data as { rows: { title: string; ownerId: string; private: boolean }[] };
        expect(tasks.rows.filter(row => row.title === 'Created by SDK')).toMatchObject([{ ownerId: 'alice', private: true }]);
      });
      expect(requests).toHaveLength(4);
      expect(requests[0]!.body.model).toBe('test/model');
      expect(requests[3]!.url).toBe('https://opencode.ai/inference/openai/v1/chat/completions');
      expect(requests[3]!.body.model).toBe('test-fallback');
      expect(JSON.stringify(requests)).not.toContain('Bob secret context');
      expect(JSON.stringify(requests[3]!.body.messages)).toContain('Created by SDK');
    } finally { fetch.mockRestore(); }
  });
  it('supports direct invocation without a chat message and saves one demo reply', async () => {
    await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
      const engine = new Engine(state.storage, tracker, { WORKCORE_AI_MODE: 'demo' });
      const id = engine.enqueue(alice, 'assistant', { message: 'Summarise my tasks' }, 'direct').data as string;
      await engine.executeNext();
      expect(engine.inspect(alice, `run:${id}`)).toMatchObject({ status: 'completed' });
      expect(engine.query(alice, 'conversation', {}).data).toMatchObject({ messages: [{ role: 'assistant', content: expect.stringContaining('Demo assistant') }] });
    });
  });
  it.each([
    { WORKCORE_AI_MODE: 'model' },
    { WORKCORE_AI_MODE: 'typo' },
    { WORKCORE_AGENT_FALLBACK_MODEL: 'openai/test' },
    { WORKCORE_AI_MODE: 'model', WORKCORE_AGENT_MODEL: 'bad-format' },
    { WORKCORE_AI_MODE: 'model', WORKCORE_AGENT_MODEL: 'unknown/model' },
  ])('fails invalid configuration without fabricating demo success: %j', async configuration => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    try {
      await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
        const engine = new Engine(state.storage, tracker, configuration);
        const id = engine.enqueue(alice, 'assistant', {}, 'invalid-config').data as string;
        await engine.executeNext();
        expect(engine.inspect(alice, `run:${id}`)).toMatchObject({ status: 'failed', error: 'AI_CONFIG' });
        expect(engine.query(alice, 'conversation', {}).data).toMatchObject({ messages: [] });
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('fails missing credentials rather than returning a demo answer', async () => {
    await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
      const engine = new Engine(state.storage, tracker, { WORKCORE_AGENT_MODEL: 'openrouter/test/model' });
      const id = engine.enqueue(alice, 'assistant', {}, 'missing-key').data as string;
      await engine.executeNext();
      expect(engine.inspect(alice, `run:${id}`)).toMatchObject({ status: 'failed', error: 'AI_CREDENTIALS' });
      expect(engine.query(alice, 'assistantSummary', {}).data).toBeNull();
      expect(engine.query(alice, 'conversation', {}).data).toMatchObject({ messages: [] });
    });
  });
  it('does not accept a foreign conversation anchor', async () => {
    await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
      const engine = new Engine(state.storage, tracker, { WORKCORE_AI_MODE: 'demo' });
      const id = engine.enqueue(alice, 'assistant', { messageId: 'foreign-message' }, 'bad-anchor').data as string;
      await engine.executeNext();
      expect(engine.inspect(alice, `run:${id}`)).toMatchObject({ status: 'failed', error: 'INVALID_MESSAGE' });
    });
  });
});
