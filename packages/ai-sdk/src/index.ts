import { dynamicTool, generateText, jsonSchema, stepCountIs, type LanguageModel, type StopCondition, type ToolSet } from 'ai';
import type { AgentEngine, AgentTraceEvent, JsonSchema, JsonValue } from '@workcore/core';

export type AiSdkEngineOptions = {
  /** Preconfigured AI SDK model instance. Provider setup and model selection belong to the application. */
  model: LanguageModel;
};

/** Create the optional Vercel AI SDK engine used by Workcore's queued agent worker. */
export function createAiSdkAgentEngine(options: AiSdkEngineOptions): AgentEngine {
  return {
    async run(args) {
      let successfulFinish = false;
      if (!Object.hasOwn(args.tools, args.finishTool)) throw new Error(`Configured finish tool '${args.finishTool}' is missing`);
      const sdkToolNames = new Map<string, string>();
      const tools: ToolSet = Object.fromEntries(Object.entries(args.tools).map(([name, definition]) => {
        const sdkName = providerToolName(name);
        if (sdkToolNames.has(sdkName)) throw new Error(`Agent tool names collide after provider normalization: '${name}' and '${sdkToolNames.get(sdkName)}'`);
        sdkToolNames.set(sdkName, name);
        return [sdkName, dynamicTool({
        ...(definition.description ? { description: definition.description } : {}),
        inputSchema: jsonSchema(definition.inputSchema as JsonSchema as never),
        execute: async (input: unknown, { abortSignal }) => {
          const output = await definition.execute(input, abortSignal);
          if (name === args.finishTool) {
            successfulFinish = true;
          }
          return output;
        },
      })];
      }));
      let result;
      try {
        result = await generateText({
          model: options.model,
          system: args.instructions,
          prompt: args.prompt,
          tools,
          // Workcore agents must complete through a checked operation tool; do not
          // let models silently end with plain text while the finish tool is pending.
          toolChoice: 'required',
          ...(args.maxOutputTokens ? { maxOutputTokens: args.maxOutputTokens } : {}),
          stopWhen: [stepCountIs(args.maxSteps), (() => successfulFinish) as StopCondition<ToolSet>],
          abortSignal: args.signal,
          onStepFinish: async ({ stepNumber, finishReason, usage, toolCalls, text, response }) => {
            await args.onEvent({ type: 'step.completed', data: {
              stepNumber, finishReason, text, modelId: response.modelId,
              usage: traceJson(usage),
              toolCalls: toolCalls.map((call) => ({ toolName: call.toolName, input: traceJson(call.input) })),
            } });
          },
        });
      } catch (error) {
        // Some providers start another generation before applying stopWhen. Once
        // the finish operation has succeeded, that follow-up is unnecessary.
        if (!successfulFinish || args.signal.aborted) throw error;
        return { finishReason: 'tool-calls', finishTool: args.finishTool };
      }
      return {
        // Agent completion and its result are defined exclusively by the
        // configured finishing tool. Model-generated text is not an outcome.
        finishReason: String(result.finishReason),
        ...(successfulFinish ? { finishTool: args.finishTool } : {}),
      };
    },
  };
}

function providerToolName(name: string) {
  return `workcore_${name.replace(/[^A-Za-z0-9_-]/g, (character) => `_u${character.codePointAt(0)!.toString(16)}_`)}`;
}

function traceJson(value: unknown): JsonValue {
  try {
    const json = JSON.stringify(value);
    if (new TextEncoder().encode(json).byteLength <= 32_768) return JSON.parse(json) as JsonValue;
    return { truncated: true };
  } catch { return { unavailable: true }; }
}

export type { AgentTraceEvent };
