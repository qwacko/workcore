# Agents

Agents are internal, queued model workflows. They are not exposed as a direct HTTP operation or client method. An application mutation or task chooses when to enqueue one, and the agent's declared tools are executed through Workcore's ordinary checked operation path.

`model` is the configured model label recorded when a run starts. With `@workcore/ai-sdk`, the application supplies the actual preconfigured model instance; step trace events record that instance's `modelId` as the effective model.

## Define an agent

```ts
import { defineWorkspace } from '@workcore/core';
import { z } from 'zod';

const input = z.object({ activityId: z.string(), request: z.string() });
const app = defineWorkspace<AppContext>()({
  id: 'tracker',
  mutations: {
    completeActivity: {
      input: z.object({ activityId: z.string() }),
      output: z.object({ ok: z.boolean() }),
      permission: 'activities.write',
      handler: ({ ctx, input }) => ctx.app.activities.complete(ctx.scope, input.activityId),
    },
    startOrganizer: {
      input,
      output: z.object({ runId: z.string() }),
      permission: 'activities.write',
      api: true,
      handler: ({ operations, input }) => operations.enqueueAgent('organizeActivity', input),
    },
  },
  agents: {
    organizeActivity: {
      input,
      permission: 'activities.write',
      model: 'openai:gpt-4.1-mini',
      instructions: 'Complete the requested activity action. Use the completion tool to finish.',
      prompt: ({ input }) => input.request,
      tools: [{ kind: 'mutation', operation: 'completeActivity', description: 'Mark the requested activity complete' }],
      finishWhen: { tool: 'mutation.completeActivity' },
      maxSteps: 6,
      maxOutputTokens: 500,
    },
  },
});
```

Agent tool names use `<kind>.<operation>`. `finishWhen.tool` must name a declared tool. A run succeeds only if that tool executes successfully; reaching a step, output-token, or time limit without the configured finish call is a failed run. Model-generated text is never an agent result: all actions and user-facing outcomes must be passed to declared operation tools. The run result is the configured finish operation's already-validated return value, so there is no separate agent result schema to transform or maintain.

`operations.enqueueAgent(name, input, { conversationId? })` is available to operation handlers and returns `{ runId }`. It validates the input, checks the agent permission, persists a run, and enqueues it. The worker checks workspace access and the agent permission again before execution. Each operation tool is independently validated and authorized. An agent's tool allowlist does not expose those operations over HTTP; the application's mutation remains the public boundary.

## Configure the AI SDK engine

The core has no model-provider dependency. Install `@workcore/ai-sdk`, `ai`, and the provider package you choose. For a single model, construct it with that provider and pass the instance directly to the adapter:

```ts
import { createAiSdkAgentEngine } from '@workcore/ai-sdk';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const agentModel = openrouter.chat('anthropic/claude-3.5-sonnet');

const platform = createPlatform({
  applications,
  auth,
  services: {
    ...stateAdapters,
    agentEngine: createAiSdkAgentEngine({ model: agentModel }),
  },
});
```

The SDK adapter uses a non-streaming tool loop and the exact model instance passed in by the application. Provider setup and model selection stay application-owned; any AI SDK provider can be used without a Workcore change. All agents handled by this engine use that model instance. If an application needs per-agent provider/model routing, it can construct a custom `AgentEngine` using the run's declared model ID. Only use model IDs chosen by trusted application configuration, not user-supplied invocation input.

## Inspect runs

The built-in read-only `GET /agent-runs` endpoint supports `agent`, `status`, `actorId`, `conversationId`, `limit`, and opaque `cursor` filters. A caller sees their own runs by default; `workcore.agents.runs.read.all` permits workspace-wide inspection. Run details are at `/agent-runs/:runId`, and trace pages at `/agent-runs/:runId/events?after=0&limit=50`.

Inspection is capability-filtered:

| Capability | Data visible |
| --- | --- |
| `workcore.agents.runs.read` | Run metadata; own runs only |
| `workcore.agents.runs.read.all` | Runs from other actors in the workspace |
| `workcore.agents.results.read` | Validated final result |
| `workcore.agents.messages.read` | Model step content captured in the trace |
| `workcore.agents.tools.read` | Tool names, status, and timing |
| `workcore.agents.toolPayloads.read` | Tool inputs and results |

The host/workspace authorizer decides which capabilities each actor receives. The typed client exposes `agentRuns()`, `agentRun(runId)`, and `agentRunEvents(runId, after?, limit?)` for these built-in queries.

## Persistence and recovery

Provide `agentRuns` storage alongside the task adapter. The memory adapter supports tests; file and PostgreSQL adapters persist run metadata and ordered trace events. PostgreSQL setup includes the agent tables in `migratePostgres()`. Configure adapter retention; terminal records and their events are pruned together, while active records are retained.

Runs use the existing task queue for execution, but agent records are separate from ordinary task results. They are excluded from the normal task listing so `workcore.tasks.read` cannot bypass agent-specific visibility controls.

Agent attempts are not automatically resumed after worker recovery. A run found in `running` state after recovery is marked `interrupted`; the worker does not replay model calls or tool side effects. Retrying is an application decision and should enqueue a new run. Run creation and task enqueue are separate adapter writes (there is no cross-adapter transaction/outbox); a process crash between them can leave an orphaned queued run. Tool execution is sequential in the first version. Streaming, approval workflows, cancellation, and resumable runs are not included yet.

## Trace sensitivity

Traces may contain model output and tool arguments/results. The run and trace endpoints require separate capabilities, payloads are bounded, and unavailable/non-JSON values are omitted from trace payloads. Avoid putting credentials or secrets in model-visible context or tool arguments. Set adapter retention to fit your privacy and compliance requirements.
