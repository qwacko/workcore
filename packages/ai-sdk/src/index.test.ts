import { describe, expect, it } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createAiSdkAgentEngine } from './index.js';

describe('AI SDK agent engine', () => {
  it('returns successfully after the finish tool without another model call', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'workcore_mutation_u2e_finish',
          input: '{"ok":true}',
        }],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
        response: { id: 'response-1', timestamp: new Date(), modelId: 'mock' },
      },
    });
    let executions = 0;
    const engine = createAiSdkAgentEngine({ model });

    const result = await engine.run({
      model: 'mock',
      instructions: 'Finish the work.',
      prompt: 'Finish the work.',
      maxSteps: 4,
      tools: {
        'mutation.finish': {
          inputSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
          execute: async () => { executions++; return { ok: true }; },
        },
      },
      finishTool: 'mutation.finish',
      signal: new AbortController().signal,
      onEvent: async () => {},
    });

    expect(executions).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(result).toMatchObject({ finishTool: 'mutation.finish', finishReason: 'tool-calls' });
  });

  it('continues after a failed finish-tool attempt so the model can correct its input', async () => {
    const response = (toolCallId: string, input: string) => ({
      content: [{ type: 'tool-call' as const, toolCallId, toolName: 'workcore_mutation_u2e_finish', input }],
      finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
      response: { id: `response-${toolCallId}`, timestamp: new Date(), modelId: 'mock' },
    });
    const model = new MockLanguageModelV3({ doGenerate: [response('bad-call', '{}'), response('good-call', '{"ok":true}')] });
    let attempts = 0;
    const result = await createAiSdkAgentEngine({ model }).run({
      model: 'mock', instructions: 'Complete through a tool.', prompt: 'Finish.', maxSteps: 4,
      tools: { 'mutation.finish': { inputSchema: { type: 'object' }, execute: async () => {
        attempts++;
        if (attempts === 1) throw new Error('Invalid tool input; please retry.');
        return { ok: true };
      } } },
      finishTool: 'mutation.finish', signal: new AbortController().signal, onEvent: async () => {},
    });
    expect(attempts).toBe(2);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(result.finishTool).toBe('mutation.finish');
  });
});
