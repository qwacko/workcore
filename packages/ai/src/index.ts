import { generateText, jsonSchema, APICallError, type LanguageModel, type ModelMessage } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { WorkcoreError, encodeJson } from '@workcore/core';
import type { Json, Operation, RunContext, Tables } from '@workcore/core';

export type ModelSpec = {
  provider: string;
  model: string;
};
export type ProviderConfig = {
  type: 'openrouter' | 'openai' | 'anthropic' | 'compatible';
  apiKeyEnv: string;
  baseURL?: string;
  api?: 'chat' | 'responses';
};
export type ModelProfile = {
  primary: ModelSpec;
  fallback?: ModelSpec;
  maxTurns?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  timeoutMs?: number;
};
export type AIConfig = {
  profiles: Record<string, ModelProfile>;
  providers?: Record<string, ProviderConfig>;
};
const providers: Record<string, ProviderConfig> = {
  openrouter: { type: 'openrouter', apiKeyEnv: 'OPENROUTER_API_KEY' },
  openai: { type: 'openai', apiKeyEnv: 'OPENAI_API_KEY' },
  anthropic: { type: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  opencode: { type: 'openai', apiKeyEnv: 'OPENCODE_API_KEY', baseURL: 'https://opencode.ai/inference/openai/v1', api: 'chat' },
  'opencode-responses': { type: 'openai', apiKeyEnv: 'OPENCODE_API_KEY', baseURL: 'https://opencode.ai/inference/openai/v1', api: 'responses' },
  'opencode-anthropic': { type: 'anthropic', apiKeyEnv: 'OPENCODE_API_KEY', baseURL: 'https://opencode.ai/inference/anthropic/v1' },
};

/** Split only the first slash: OpenRouter model IDs themselves contain slashes. */
export function modelSpec(value: string): ModelSpec {
  const slash = value.indexOf('/');
  if (slash < 1 || slash === value.length - 1) throw new WorkcoreError('AI_CONFIG', 'Model must be provider/model');
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

export function resolveModel(spec: ModelSpec, env: unknown, configured: AIConfig['providers'] = {}): LanguageModel {
  const available = { ...providers, ...configured };
  const provider = Object.hasOwn(available, spec.provider) ? available[spec.provider] : undefined;
  if (!provider) throw new WorkcoreError('AI_CONFIG', 'Unknown AI provider');
  const key = (env as Record<string, unknown>)[provider.apiKeyEnv];
  if (typeof key !== 'string' || !key.trim()) throw new WorkcoreError('AI_CREDENTIALS', `Missing environment binding ${provider.apiKeyEnv}`);
  if (provider.baseURL && new URL(provider.baseURL).protocol !== 'https:') throw new WorkcoreError('AI_CONFIG', 'Provider baseURL must use HTTPS');
  const options = { apiKey: key, ...(provider.baseURL ? { baseURL: provider.baseURL } : {}) };
  switch (provider.type) {
    case 'openrouter': return createOpenRouter(options)(spec.model);
    case 'anthropic': return createAnthropic(options)(spec.model);
    case 'openai': {
      const client = createOpenAI(options);
      return provider.api === 'chat' ? client.chat(spec.model) : client.responses(spec.model);
    }
    case 'compatible':
      if (!provider.baseURL) throw new WorkcoreError('AI_CONFIG', 'Compatible providers require baseURL');
      return createOpenAICompatible({ ...options, name: spec.provider, baseURL: provider.baseURL })(spec.model);
  }
}

const checkedOperation = Symbol('checked-operation');
export type AgentTool<S extends z.ZodType = any> = {
  [checkedOperation]?: true;
  description: string;
  inputSchema: S;
  /** Successful execution completes the agent without another inference request. */
  terminal?: boolean;
  /** Optional application-authored chat text; model prose is ignored on tool completion. */
  completionText?: (result: Json) => string;
  execute(input: z.output<S>, signal: AbortSignal): Promise<Json> | Json;
};
export function externalTool<S extends z.ZodType>(definition: AgentTool<S>): AgentTool<S> { return definition; }

/** Mark either a checked operation tool or an external tool as a completion action. */
export function terminatingTool<S extends z.ZodType>(tool: AgentTool<S>, options: { text?: (result: Json) => string } = {}): AgentTool<S> {
  return { ...tool, terminal: true, ...(options.text ? { completionText: options.text } : {}) };
}

/** Operation identity is retained: the runner still checks registration, allowlists and current authority. */
export function operationTool<T extends Tables, E, I extends z.ZodType, O extends z.ZodType>(
  ctx: RunContext<T, E>, kind: 'read' | 'mutate', operation: Operation<I, O>, description: string,
): AgentTool<I> {
  return { description, inputSchema: operation.input, [checkedOperation]: true, execute: input => ctx[kind](operation, input as z.input<I>) as Json };
}

type Usage = { inputTokens: number; outputTokens: number; totalTokens: number };
type Turn = { text: string; messages: Json[]; calls: { id: string; name: string; input: Json }[]; usage: Usage; finishReason: string };
type Context = Pick<RunContext<any, any>, 'env' | 'signal' | 'step' | 'progress'>;
export type CompletionMode = 'text-or-tool' | 'tool-required';
export type AgentResult = { text: string; turns: number; usage: Usage; model: ModelSpec; fallbackAttempts: number } & (
  | { finishReason: 'text' }
  | { finishReason: 'tool'; tool: { name: string; result: Json } }
);

function limit(value: number | undefined, fallback: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > max) throw new WorkcoreError('AI_CONFIG', 'Invalid AI execution limit');
  return result;
}
function retryable(error: unknown): boolean {
  return APICallError.isInstance(error) && (error.isRetryable || error.statusCode === 401 || error.statusCode === 403)
    || error instanceof WorkcoreError && error.code === 'AI_CREDENTIALS'
    || error instanceof TypeError; // fetch transport failure; never a tool failure (tools run outside this boundary)
}

/** Bounded SDK model/tool loop. Fallback encloses inference ONLY, never tool execution. No automatic replay/resumption. */
export function createAI(config: AIConfig, options: { resolve?: typeof resolveModel } = {}) {
  return {
    async run(ctx: Context, input: {
      profile: string;
      system: string;
      messages: ModelMessage[];
      tools?: Record<string, AgentTool>;
      /** Fixed for the whole run, including profile switches and provider fallback. */
      completion?: CompletionMode;
      /** Select a named profile for each turn (e.g. planning versus writing). */
      selectProfile?: (turn: number) => string;
    }): Promise<AgentResult> {
      const messages = [...input.messages];
      const tools = input.tools ?? {};
      const completion = input.completion ?? 'text-or-tool';
      if (!['text-or-tool', 'tool-required'].includes(completion)) throw new WorkcoreError('AI_CONFIG', 'Unknown completion mode');
      const terminalNames = Object.entries(tools).filter(([, tool]) => tool.terminal === true).map(([name]) => name);
      if (completion === 'tool-required' && !terminalNames.length) throw new WorkcoreError('AI_CONFIG', 'tool-required completion needs a terminating tool');
      const schemas = Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new WorkcoreError('AI_CONFIG', 'Invalid tool name');
        return [name, { description: tool.description, inputSchema: jsonSchema(JSON.parse(JSON.stringify(z.toJSONSchema(tool.inputSchema, { io: 'input' })))) }];
      }));
      const initial = Object.hasOwn(config.profiles, input.profile) ? config.profiles[input.profile] : undefined;
      if (!initial) throw new WorkcoreError('AI_CONFIG', 'Unknown model profile');
      const maxTurns = limit(initial.maxTurns, 8, 30);
      const tokenLimit = limit(initial.maxTotalTokens, 32_000, 1_000_000);
      const timeout = AbortSignal.timeout(limit(initial.timeoutMs, 120_000, 600_000));
      const signal = AbortSignal.any([ctx.signal, timeout]);
      const checkAbort = () => {
        if (ctx.signal.aborted) throw new WorkcoreError('CANCELLED', 'Cancellation requested');
        if (timeout.aborted) throw new WorkcoreError('AI_TIMEOUT', 'Agent deadline reached');
      };
      const usage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      let fallbackAttempts = 0;
      let chosen = initial.primary;
      const completionInstruction = `Execution requirement: text alone cannot complete this task. Continue using tools until you successfully call one terminating tool (${terminalNames.join(', ')}). A terminating tool must be called alone, without any other tool calls in that response.`;
      const system = completion === 'tool-required' ? `${input.system}\n\n${completionInstruction}` : input.system;
      const progress = (phase: string, turn: number, profile: string, extra: Record<string, Json> = {}) => {
        checkAbort();
        ctx.progress({ phase, turn, maxTurns, profile, model: chosen, usage: { ...usage }, fallbackAttempts, completionMode: completion, ...extra });
      };
      for (let index = 0; index < maxTurns; index++) {
        checkAbort();
        const profileName = input.selectProfile?.(index + 1) ?? input.profile;
        const profile = Object.hasOwn(config.profiles, profileName) ? config.profiles[profileName] : undefined;
        if (!profile) throw new WorkcoreError('AI_CONFIG', 'Unknown model profile');
        const maxOutputTokens = Math.min(limit(profile.maxOutputTokens, 2048, 32_000), tokenLimit - usage.totalTokens);
        if (maxOutputTokens <= 0) throw new WorkcoreError('AI_TOKEN_LIMIT', 'Agent token budget reached');
        const candidates = [profile.primary, ...(profile.fallback ? [profile.fallback] : [])];
        let turn: Turn | undefined;
        for (const [attempt, spec] of candidates.entries()) {
          chosen = spec;
          if (attempt) fallbackAttempts++;
          progress(attempt ? 'fallback' : 'model', index + 1, profileName);
          try {
            turn = await ctx.step(`Model turn ${index + 1} · ${spec.provider}/${spec.model}${attempt ? ' · fallback' : ''}`, async () => {
              // No execute callbacks: successful tool effects cannot be inside the fallback boundary.
              const result = await generateText({
                model: (options.resolve ?? resolveModel)(spec, ctx.env, config.providers),
                system, messages, tools: schemas, maxOutputTokens,
                maxRetries: 0, abortSignal: signal,
              });
              return {
                text: result.text,
                // Preserve reasoning/tool signatures needed by subsequent provider calls, not HTTP metadata.
                messages: JSON.parse(JSON.stringify(result.response.messages)) as Json[],
                calls: result.toolCalls.map(call => ({ id: call.toolCallId, name: call.toolName, input: JSON.parse(encodeJson(call.input)) as Json })),
                finishReason: result.finishReason,
                usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0, totalTokens: result.usage.totalTokens ?? 0 },
              };
            });
            break;
          } catch (error) {
            checkAbort();
            if (attempt === candidates.length - 1 || !retryable(error)) {
              if (error instanceof WorkcoreError) throw error;
              // Provider errors can contain headers, request bodies and credentials. Never persist/print them.
              throw new WorkcoreError('AI_MODEL_FAILED', 'Model request failed');
            }
          }
        }
        if (!turn) throw new WorkcoreError('AI_MODEL_FAILED', 'No model response');
        for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) usage[key] += turn.usage[key];
        progress('model-completed', index + 1, profileName);
        if (usage.totalTokens > tokenLimit) throw new WorkcoreError('AI_TOKEN_LIMIT', 'Agent token budget reached');
        if (!['stop', 'tool-calls'].includes(turn.finishReason)) throw new WorkcoreError('AI_INCOMPLETE', 'Model did not finish normally');
        if (!turn.calls.length) {
          if (completion === 'tool-required' && turn.finishReason === 'stop') {
            progress('awaiting-termination', index + 1, profileName);
            if (index + 1 === maxTurns) throw new WorkcoreError('AI_TURN_LIMIT', 'Agent turn limit reached without a terminating tool');
            messages.push(...turn.messages as unknown as ModelMessage[]);
            messages.push({ role: 'user', content: completionInstruction });
            continue;
          }
          if (turn.finishReason !== 'stop' || !turn.text.trim()) throw new WorkcoreError('AI_INCOMPLETE', 'Model did not produce a complete text answer');
          progress('completed', index + 1, profileName, { completion: { kind: 'text' } });
          return { finishReason: 'text', text: turn.text, turns: index + 1, usage, model: chosen, fallbackAttempts };
        }
        const terminal = turn.calls.some(call => Object.hasOwn(tools, call.name) && tools[call.name]?.terminal === true);
        // Validate the whole batch before executing even its first ordinary tool.
        if (terminal && turn.calls.length !== 1) throw new WorkcoreError('AI_TERMINAL_CONFLICT', 'A terminating tool must be the only tool call in a response');
        // Do not perform side effects when there is no turn left to interpret their results.
        if (index + 1 === maxTurns && !terminal) throw new WorkcoreError('AI_TURN_LIMIT', 'Agent turn limit reached');
        messages.push(...turn.messages as unknown as ModelMessage[]);
        for (const call of turn.calls) {
          progress('tool', index + 1, profileName, { tool: call.name });
          const tool = tools[call.name];
          if (!tool || !Object.hasOwn(tools, call.name)) throw new WorkcoreError('TOOL_DENIED', 'Unknown tool');
          const result = await ctx.step(`Tool · ${call.name}`, async () => {
            checkAbort();
            const parsed = tool[checkedOperation] ? { success: true, data: call.input } : tool.inputSchema.safeParse(call.input);
            if (!parsed.success) throw new WorkcoreError('AI_TOOL_INPUT', 'Invalid model tool input');
            try { return await tool.execute(parsed.data, signal); }
            catch (error) {
              checkAbort();
              if (error instanceof WorkcoreError) throw error;
              throw new WorkcoreError('AI_TOOL_FAILED', 'Tool execution failed');
            }
          });
          if (tool.terminal === true) {
            checkAbort();
            let text = '';
            try {
              text = tool.completionText?.(result) ?? '';
              if (typeof text !== 'string') throw new Error('Invalid completion text');
              encodeJson(text, 32_768);
            } catch { throw new WorkcoreError('AI_COMPLETION_TEXT_FAILED', 'Unable to format tool completion text'); }
            progress('completed', index + 1, profileName, { completion: { kind: 'tool', tool: call.name } });
            return { finishReason: 'tool', tool: { name: call.name, result }, text, turns: index + 1, usage, model: chosen, fallbackAttempts };
          }
          messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: call.id, toolName: call.name, output: { type: 'json', value: result } }] });
        }
      }
      throw new WorkcoreError('AI_TURN_LIMIT', 'Agent turn limit reached');
    },
  };
}

export type { ModelMessage, LanguageModel } from 'ai';
