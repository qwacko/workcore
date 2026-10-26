import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { APICallError } from 'ai';
import { z } from 'zod';
import { createAI, externalTool, modelSpec, operationTool, resolveModel, terminatingTool } from '../packages/ai/src/index.js';
import type { ModelProfile } from '../packages/ai/src/index.js';
import { table, workspace } from '../packages/core/src/index.js';
import type { Json } from '../packages/core/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import type { Run } from '../packages/core/src/store.js';

type Response = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;
function response(content: Response['content'] = [{ type: 'text', text: 'All done' }]): Response {
  return { content, finishReason: { unified: content.some(part => part.type === 'tool-call') ? 'tool-calls' : 'stop', raw: undefined },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } }, warnings: [] };
}
const call = () => response([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'write', input: '{"title":"Created"}' }]);
const spec = { provider: 'primary', model: 'test' };
const profile: ModelProfile = { primary: spec, fallback: { provider: 'backup', model: 'other' } };
const prompt = { profile: 'assistant', system: 'Help', messages: [{ role: 'user' as const, content: 'Do work' }] };
function context() {
  const controller = new AbortController();
  return { env: {}, signal: controller.signal, controller, progress: vi.fn(), step: async <R extends Json>(_label: string, execute: () => Promise<R>) => execute() };
}
const app = workspace({ notes: table(z.object({ title: z.string() })) });
const empty = z.object({});
const write = app.mutation({ input: z.object({ title: z.string() }), output: z.string(), handler: ({ db }, input) => { db.put('notes', 'one', input); return 'one'; } });

describe('AI SDK integration', () => {
  it.each([undefined, 'text-or-tool'] as const)('allows text completion with the default/explicit policy (%s)', async completion => {
    const model = new MockLanguageModelV4({ doGenerate: response() });
    const result = await createAI({ profiles: { assistant: profile } }, { resolve: () => model }).run(context(), { ...prompt, completion });
    expect(result).toMatchObject({ finishReason: 'text', text: 'All done', turns: 1 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it('requires a terminating tool before making any inference request', async () => {
    const resolve = vi.fn(() => new MockLanguageModelV4());
    const ai = createAI({ profiles: { assistant: profile } }, { resolve });
    await expect(ai.run(context(), { ...prompt, completion: 'tool-required' })).rejects.toMatchObject({ code: 'AI_CONFIG' });
    await expect(ai.run(context(), { ...prompt, completion: 'tool-required', tools: { write: externalTool({ description: 'Ordinary', inputSchema: write.input, execute: () => null }) } })).rejects.toMatchObject({ code: 'AI_CONFIG' });
    expect(resolve).not.toHaveBeenCalled();
  });
  it('reminds after text-only output, continues ordinary tools, then terminates on the last turn', async () => {
    const finish = response([{ type: 'tool-call', toolCallId: 'finish-1', toolName: 'finish', input: '{}' }]);
    const model = new MockLanguageModelV4({ doGenerate: [response(), call(), finish] });
    const ctx = context();
    const writeResult = vi.fn(() => 'written');
    const finishResult = vi.fn(() => ({ report: 'saved' }));
    const result = await createAI({ profiles: { assistant: { ...profile, maxTurns: 3 } } }, { resolve: () => model }).run(ctx, {
      ...prompt, completion: 'tool-required', tools: {
        write: externalTool({ description: 'Ordinary', inputSchema: write.input, execute: writeResult }),
        finish: terminatingTool(externalTool({ description: 'Finish', inputSchema: empty, execute: finishResult })),
      },
    });
    expect(result).toMatchObject({ finishReason: 'tool', text: '', turns: 3, usage: { totalTokens: 45 }, tool: { name: 'finish', result: { report: 'saved' } } });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(writeResult).toHaveBeenCalledTimes(1);
    expect(finishResult).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('text alone cannot complete');
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('All done');
    expect(ctx.progress.mock.calls.some(([value]) => value.phase === 'awaiting-termination')).toBe(true);
    expect(ctx.progress).toHaveBeenLastCalledWith(expect.objectContaining({ completionMode: 'tool-required', completion: { kind: 'tool', tool: 'finish' } }));
  });
  it('exhausts the turn budget rather than accepting repeated text-only answers', async () => {
    const model = new MockLanguageModelV4({ doGenerate: response() });
    const execute = vi.fn(() => null);
    const ctx = context();
    await expect(createAI({ profiles: { assistant: { ...profile, maxTurns: 2 } } }, { resolve: () => model }).run(ctx, {
      ...prompt, completion: 'tool-required', tools: { write: terminatingTool(externalTool({ description: 'Finish', inputSchema: write.input, execute })) },
    })).rejects.toMatchObject({ code: 'AI_TURN_LIMIT' });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(execute).not.toHaveBeenCalled();
    expect(ctx.progress.mock.calls.some(([value]) => value.phase === 'completed')).toBe(false);
    expect(ctx.progress).toHaveBeenLastCalledWith(expect.objectContaining({ turn: 2, usage: expect.objectContaining({ totalTokens: 30 }) }));
  });
  it('counts text-only attempts against the token budget', async () => {
    const model = new MockLanguageModelV4({ doGenerate: response() });
    await expect(createAI({ profiles: { assistant: { ...profile, maxTotalTokens: 15 } } }, { resolve: () => model }).run(context(), {
      ...prompt, completion: 'tool-required', tools: { write: terminatingTool(externalTool({ description: 'Finish', inputSchema: write.input, execute: () => null })) },
    })).rejects.toMatchObject({ code: 'AI_TOKEN_LIMIT' });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it('keeps the completion policy across fallback and profile switches', async () => {
    const primary = new MockLanguageModelV4({ doGenerate: async () => { throw new APICallError({ message: 'Unavailable', url: 'https://provider', requestBodyValues: {}, statusCode: 503, isRetryable: true }); } });
    const backup = new MockLanguageModelV4({ doGenerate: response() });
    const writer = new MockLanguageModelV4({ doGenerate: call() });
    const ai = createAI({ profiles: { assistant: profile, writing: { primary: { provider: 'writer', model: 'test' } } } }, { resolve: spec => spec.provider === 'writer' ? writer : spec.provider === 'backup' ? backup : primary });
    const result = await ai.run(context(), {
      ...prompt, completion: 'tool-required', selectProfile: turn => turn === 1 ? 'assistant' : 'writing',
      tools: { write: terminatingTool(externalTool({ description: 'Finish', inputSchema: write.input, execute: () => null })) },
    });
    expect(result).toMatchObject({ finishReason: 'tool', turns: 2, fallbackAttempts: 1 });
    expect(JSON.stringify(backup.doGenerateCalls[0]!.prompt)).toContain('text alone cannot complete');
    expect(JSON.stringify(writer.doGenerateCalls[0]!.prompt)).toContain('text alone cannot complete');
  });
  it('completes via a tool on the last allowed turn without requiring text or another inference', async () => {
    const model = new MockLanguageModelV4({ doGenerate: call() });
    const execute = vi.fn(() => ({ saved: true }));
    const ctx = context();
    const ai = createAI({ profiles: { assistant: { ...profile, maxTurns: 1 } } }, { resolve: () => model });
    const result = await ai.run(ctx, { ...prompt, tools: { write: terminatingTool(externalTool({ description: 'Save and finish', inputSchema: write.input, execute })) } });
    expect(result).toMatchObject({ finishReason: 'tool', tool: { name: 'write', result: { saved: true } }, text: '', turns: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(ctx.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'completed', completion: { kind: 'tool', tool: 'write' } }));
  });
  it('uses application-supplied completion text rather than model prose', async () => {
    const turn = call();
    turn.content.unshift({ type: 'text', text: 'Untrusted premature success message' });
    const model = new MockLanguageModelV4({ doGenerate: turn });
    const result = await createAI({ profiles: { assistant: profile } }, { resolve: () => model }).run(context(), {
      ...prompt, tools: { write: terminatingTool(externalTool({ description: 'Finish', inputSchema: write.input, execute: () => ({ id: 'report-1' }) }), { text: result => `Saved ${(result as { id: string }).id}` }) },
    });
    expect(result).toMatchObject({ finishReason: 'tool', text: 'Saved report-1' });
  });
  it.each(['first', 'last', 'duplicate'] as const)('rejects mixed/duplicate terminating calls before effects (%s)', async order => {
    const terminal = { type: 'tool-call' as const, toolCallId: 'end', toolName: 'finish', input: '{}' };
    const ordinary = call().content[0]!;
    const model = new MockLanguageModelV4({ doGenerate: response(order === 'first' ? [terminal, ordinary] : order === 'last' ? [ordinary, terminal] : [terminal, { ...terminal, toolCallId: 'end-2' }]) });
    const execute = vi.fn(() => null);
    const ai = createAI({ profiles: { assistant: profile } }, { resolve: () => model });
    await expect(ai.run(context(), { ...prompt, tools: {
      write: externalTool({ description: 'Ordinary', inputSchema: write.input, execute }),
      finish: terminatingTool(externalTool({ description: 'Finish', inputSchema: empty, execute })),
    } })).rejects.toMatchObject({ code: 'AI_TERMINAL_CONFLICT' });
    expect(execute).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it('fails a terminating tool without fallback or a completed outcome', async () => {
    const model = new MockLanguageModelV4({ doGenerate: call() });
    const resolve = vi.fn(() => model);
    const ctx = context();
    await expect(createAI({ profiles: { assistant: profile } }, { resolve }).run(ctx, {
      ...prompt, tools: { write: terminatingTool(externalTool({ description: 'Fail', inputSchema: write.input, execute: () => { throw new Error('secret'); } })) },
    })).rejects.toMatchObject({ code: 'AI_TOOL_FAILED' });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(ctx.progress.mock.calls.some(([progress]) => progress.phase === 'completed')).toBe(false);
  });
  it('does not report tool completion after cancellation', async () => {
    const ctx = context();
    const model = new MockLanguageModelV4({ doGenerate: call() });
    await expect(createAI({ profiles: { assistant: profile } }, { resolve: () => model }).run(ctx, {
      ...prompt, tools: { write: terminatingTool(externalTool({ description: 'Cancel', inputSchema: write.input, execute: () => { ctx.controller.abort(); return null; } })) },
    })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ctx.progress.mock.calls.some(([progress]) => progress.phase === 'completed')).toBe(false);
  });
  it('rejects invalid terminating input without executing or completing', async () => {
    const model = new MockLanguageModelV4({ doGenerate: call() });
    const execute = vi.fn(() => null);
    const ctx = context();
    await expect(createAI({ profiles: { assistant: profile } }, { resolve: () => model }).run(ctx, {
      ...prompt, tools: { write: terminatingTool(externalTool({ description: 'Finish', inputSchema: z.object({ title: z.string().refine(() => false) }), execute })) },
    })).rejects.toMatchObject({ code: 'AI_TOOL_INPUT' });
    expect(execute).not.toHaveBeenCalled();
    expect(ctx.progress.mock.calls.some(([progress]) => progress.phase === 'completed')).toBe(false);
  });
  it('does not replay successful effects if completion-text formatting fails', async () => {
    const model = new MockLanguageModelV4({ doGenerate: call() });
    const execute = vi.fn(() => null);
    const resolve = vi.fn(() => model);
    await expect(createAI({ profiles: { assistant: profile } }, { resolve }).run(context(), {
      ...prompt, tools: { write: terminatingTool(externalTool({ description: 'Finish', inputSchema: write.input, execute }), { text: () => { throw new Error('secret'); } }) },
    })).rejects.toMatchObject({ code: 'AI_COMPLETION_TEXT_FAILED' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('persists a checked terminating mutation outcome and its completion metadata', async () => {
    const model = new MockLanguageModelV4({ doGenerate: call() });
    const ai = createAI({ profiles: { assistant: { ...profile, maxTurns: 1 } } }, { resolve: () => model });
    const agent = app.agent({ input: empty, output: z.object({ finishReason: z.literal('tool'), tool: z.object({ name: z.string(), result: z.json() }), text: z.string() }), tools: [write], handler: async ctx => {
      const result = await ai.run(ctx, { ...prompt, completion: 'tool-required', tools: { write: terminatingTool(operationTool(ctx, 'mutate', write, 'Save and finish')) } });
      if (result.finishReason !== 'tool') throw new Error('Expected tool completion');
      return result;
    } });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
      const engine = new Engine(state.storage, app.define({ views: {}, queries: {}, mutations: { write }, jobs: { agent }, authorize: () => true }), {});
      const id = engine.enqueue({ id: 'alice' }, 'agent', {}, 'terminal').data as string;
      await engine.executeNext();
      expect(engine.inspect({ id: 'alice' }, `run:${id}`)).toMatchObject({ status: 'completed', result: { finishReason: 'tool', text: '', tool: { name: 'write', result: 'one' } }, progress: { completion: { kind: 'tool', tool: 'write' } } });
      expect(engine.inspect({ id: 'alice' }, 'table:notes')).toMatchObject({ rows: [{ data: { title: 'Created' } }] });
      expect(model.doGenerateCalls).toHaveLength(1);
    });
  });
  it('parses provider/model IDs and resolves environment credentials without global process.env', () => {
    expect(modelSpec('openrouter/anthropic/claude')).toEqual({ provider: 'openrouter', model: 'anthropic/claude' });
    expect(() => modelSpec('invalid')).toThrow('provider/model');
    expect(() => resolveModel({ provider: 'openai', model: 'test' }, {})).toThrow('OPENAI_API_KEY');
    expect(resolveModel({ provider: 'openai', model: 'test' }, { OPENAI_API_KEY: 'fake' })).toMatchObject({ provider: 'openai.responses', modelId: 'test' });
    expect(resolveModel({ provider: 'opencode', model: 'test' }, { OPENCODE_API_KEY: 'fake' })).toMatchObject({ modelId: 'test' });
    expect(() => resolveModel({ provider: 'custom', model: 'test' }, { KEY: 'secret' }, { custom: { type: 'compatible', apiKeyEnv: 'KEY', baseURL: 'http://unsafe' } })).toThrow('HTTPS');
  });
  it('runs multiple model/tool turns and changes profiles between calls', async () => {
    const first = new MockLanguageModelV4({ doGenerate: call() });
    const second = new MockLanguageModelV4({ doGenerate: response() });
    const execute = vi.fn(() => 'written');
    const ai = createAI({ profiles: { assistant: profile, writing: { primary: { provider: 'writer', model: 'final' } } } }, { resolve: spec => spec.provider === 'writer' ? second : first });
    const ctx = context();
    const result = await ai.run(ctx, { ...prompt, selectProfile: turn => turn === 1 ? 'assistant' : 'writing', tools: { write: externalTool({ description: 'Write', inputSchema: write.input, execute }) } });
    expect(result).toMatchObject({ text: 'All done', turns: 2, model: { provider: 'writer' }, usage: { totalTokens: 30 } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(second.doGenerateCalls[0]!.prompt).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool' })]));
    expect(ctx.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'completed', turn: 2 }));
  });
  it('uses the actual OpenRouter HTTP adapter with an environment-supplied key (mocked network)', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'chat-test', object: 'chat.completion', created: 1, model: 'test/model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'HTTP adapter works' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    }), { headers: { 'content-type': 'application/json' } }));
    try {
      const ctx = { ...context(), env: { OPENROUTER_API_KEY: 'test-only-key' } };
      const result = await createAI({ profiles: { assistant: { primary: { provider: 'openrouter', model: 'test/model' } } } }).run(ctx, prompt);
      expect(result).toMatchObject({ text: 'HTTP adapter works', usage: { totalTokens: 7 } });
      expect(String(fetch.mock.calls[0]![0])).toBe('https://openrouter.ai/api/v1/chat/completions');
      const request = fetch.mock.calls[0]![1]!;
      expect(new Headers(request.headers).get('authorization')).toBe('Bearer test-only-key');
      expect(JSON.stringify(ctx.progress.mock.calls)).not.toContain('test-only-key');
    } finally { fetch.mockRestore(); }
  });
  it('uses backup when only its credentials are configured', async () => {
    const backup = new MockLanguageModelV4({ doGenerate: response() });
    const ai = createAI({ profiles: { assistant: { primary: { provider: 'openai', model: 'test' }, fallback: profile.fallback } } }, {
      resolve: (spec, env) => spec.provider === 'backup' ? backup : resolveModel(spec, env),
    });
    expect(await ai.run(context(), prompt)).toMatchObject({ fallbackAttempts: 1, model: { provider: 'backup' } });
  });
  it('falls back on a later inference failure without replaying a successful mutation', async () => {
    let count = 0;
    const primary = new MockLanguageModelV4({ doGenerate: async () => { if (++count === 1) return call(); throw new APICallError({ message: 'Unavailable secret-key', url: 'https://provider', requestBodyValues: {}, statusCode: 503, isRetryable: true }); } });
    const backup = new MockLanguageModelV4({ doGenerate: response() });
    const ai = createAI({ profiles: { assistant: profile } }, { resolve: spec => spec.provider === 'backup' ? backup : primary });
    const agent = app.agent({ input: empty, output: z.string(), tools: [write], handler: async ctx => (await ai.run(ctx, { ...prompt, tools: { write: operationTool(ctx, 'mutate', write, 'Write') } })).text });
    const definition = app.define({ views: {}, queries: {}, mutations: { write }, jobs: { agent }, authorize: () => true });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
      const engine = new Engine(state.storage, definition, {});
      const id = engine.enqueue({ id: 'alice' }, 'agent', {}, crypto.randomUUID()).data as string;
      await engine.executeNext();
      expect(engine.inspect({ id: 'alice' }, `run:${id}`)).toMatchObject({ status: 'completed', progress: { turn: 2, fallbackAttempts: 1, usage: { totalTokens: 30 } } });
      expect(engine.inspect({ id: 'alice' }, 'table:notes')).toMatchObject({ rows: [{ revision: expect.any(Number), data: { title: 'Created' } }] });
      const history = engine.inspect({ id: 'alice' }, 'history') as { rows: { operation: string }[] };
      expect(history.rows.filter(row => row.operation === 'mutation:write')).toHaveLength(1);
      const trace = engine.trace({ id: 'alice' }, id) as { rows: Json[] };
      expect(JSON.stringify(trace)).not.toContain('secret-key');
      expect(backup.doGenerateCalls[0]!.prompt).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool' })]));
    });
  });
  it('does not use fallback for a failed tool, and preserves checked allowlists', async () => {
    const model = new MockLanguageModelV4({ doGenerate: call() });
    const resolve = vi.fn(() => model);
    const ai = createAI({ profiles: { assistant: profile } }, { resolve });
    const execute = vi.fn(() => { throw new Error('Tool failed'); });
    await expect(ai.run(context(), { ...prompt, tools: { write: externalTool({ description: 'Write', inputSchema: write.input, execute }) } })).rejects.toThrow('Tool execution failed');
    expect(resolve).toHaveBeenCalledTimes(1);
    const agent = app.agent({ input: empty, output: z.string(), tools: [], handler: async ctx => (await ai.run(ctx, { ...prompt, tools: { write: terminatingTool(operationTool(ctx, 'mutate', write, 'Write')) } })).text });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
      const engine = new Engine(state.storage, app.define({ views: {}, queries: {}, mutations: { write }, jobs: { agent }, authorize: () => true }), {});
      const id = engine.enqueue({ id: 'alice' }, 'agent', {}, 'denied').data as string;
      await engine.executeNext();
      expect(engine.inspect({ id: 'alice' }, `run:${id}`)).toMatchObject({ status: 'failed', error: 'TOOL_DENIED' });
      expect(engine.inspect({ id: 'alice' }, 'table:notes')).toMatchObject({ rows: [] });
    });
  });
  it('enforces turn/token limits before further tool effects', async () => {
    const execute = vi.fn(() => null);
    const model = new MockLanguageModelV4({ doGenerate: call() });
    const ai = createAI({ profiles: { assistant: { ...profile, maxTurns: 1 } } }, { resolve: () => model });
    await expect(ai.run(context(), { ...prompt, tools: { write: externalTool({ description: 'Write', inputSchema: write.input, execute }) } })).rejects.toThrow('turn limit');
    expect(execute).not.toHaveBeenCalled();
    const limited = createAI({ profiles: { assistant: { ...profile, maxTotalTokens: 1 } } }, { resolve: () => model });
    await expect(limited.run(context(), prompt)).rejects.toThrow('token budget');
  });
  it('cancels in-flight inference without falling back and sanitises provider failures', async () => {
    const ctx = context();
    const model = new MockLanguageModelV4({ doGenerate: async ({ abortSignal }) => {
      ctx.controller.abort();
      abortSignal!.throwIfAborted();
      return response();
    } });
    const resolve = vi.fn(() => model);
    await expect(createAI({ profiles: { assistant: profile } }, { resolve }).run(ctx, prompt)).rejects.toThrow();
    expect(resolve).toHaveBeenCalledTimes(1);
    const failed = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('Bearer secret-key'); } });
    await expect(createAI({ profiles: { assistant: profile } }, { resolve: () => failed }).run(context(), prompt)).rejects.toThrow('Model request failed');
  });
  it('times out a pending model call without invoking backup', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async ({ abortSignal }) => {
      await new Promise<void>((_resolve, reject) => {
        if (abortSignal!.aborted) reject(abortSignal!.reason);
        else abortSignal!.addEventListener('abort', () => reject(abortSignal!.reason), { once: true });
      });
      return response();
    } });
    const resolve = vi.fn(() => model);
    await expect(createAI({ profiles: { assistant: { ...profile, timeoutMs: 20 } } }, { resolve }).run(context(), prompt)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('does not fall back for invalid provider requests', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new APICallError({ message: 'Bad request with secret', url: 'https://provider', requestBodyValues: {}, statusCode: 400, isRetryable: false }); } });
    const resolve = vi.fn(() => model);
    await expect(createAI({ profiles: { assistant: profile } }, { resolve }).run(context(), prompt)).rejects.toMatchObject({ code: 'AI_MODEL_FAILED' });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('applies external tool transforms exactly once', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [call(), response()] });
    const transform = vi.fn((title: string) => title + '!');
    const execute = vi.fn(() => null);
    await createAI({ profiles: { assistant: profile } }, { resolve: () => model }).run(context(), {
      ...prompt, tools: { write: externalTool({ description: 'Transform', inputSchema: z.object({ title: z.string().transform(transform) }), execute }) },
    });
    expect(transform).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ title: 'Created!' }, expect.anything());
  });
  it('preserves reasoning signatures between model turns', async () => {
    const first = call();
    first.content.unshift({ type: 'reasoning', text: 'Plan', providerMetadata: { anthropic: { signature: 'test-signature' } } });
    const model = new MockLanguageModelV4({ doGenerate: [first, response()] });
    await createAI({ profiles: { assistant: profile } }, { resolve: () => model }).run(context(), {
      ...prompt, tools: { write: externalTool({ description: 'Write', inputSchema: write.input, execute: () => null }) },
    });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('test-signature');
  });
  it('rechecks mutation authority inside the model-selected tool', async () => {
    const model = new MockLanguageModelV4({ doGenerate: call() });
    const ai = createAI({ profiles: { assistant: profile } }, { resolve: () => model });
    const agent = app.agent({ input: empty, output: z.string(), tools: [write], handler: async ctx => (await ai.run(ctx, { ...prompt, tools: { write: operationTool(ctx, 'mutate', write, 'Write') } })).text });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    await runInDurableObject(bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID())), async (_instance, state) => {
      const engine = new Engine(state.storage, app.define({ views: {}, queries: {}, mutations: { write }, jobs: { agent }, authorize: (_ctx, action) => action !== 'mutation:write' }), {});
      const id = engine.enqueue({ id: 'alice' }, 'agent', {}, 'authority').data as string;
      await engine.executeNext();
      expect(engine.inspect({ id: 'alice' }, `run:${id}`)).toMatchObject({ status: 'failed', error: 'FORBIDDEN' });
      expect(engine.inspect({ id: 'alice' }, 'table:notes')).toMatchObject({ rows: [] });
    });
  });
});
