# AI SDK agents

`@workcore/ai` is an optional integration with Vercel AI SDK. It works inside the existing Cloudflare Durable Object runner: no Node server, external orchestrator or Agents SDK is required.

AI SDK supplies provider protocols, tool-call parsing and model results. Workcore supplies a bounded sequential model/tool loop, checked operations, persisted evidence and interruption policy. Model and tool execution are separate so fallback cannot replay a completed mutation.

## Model profiles and credentials

```ts
import { createAI } from '@workcore/ai';

const ai = createAI({
  profiles: {
    planning: {
      primary: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
      fallback: { provider: 'openai', model: 'gpt-4.1-mini' },
      maxTurns: 8,
      maxOutputTokens: 1500,
      maxTotalTokens: 24_000,
      timeoutMs: 120_000,
    },
    writing: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    },
  },
});
```

Choose a profile on each `ai.run()` call. Optionally provide `selectProfile(turn)` to choose another named profile before each turn within that loop. The initial profile fixes the loop's overall turn/token/deadline limits; each selected profile supplies that turn's primary, backup and output-token cap. Profiles are application configuration, not an operation for clients to select arbitrary endpoints or credentials.

Built-in provider IDs:

| Provider ID | Environment binding | API |
| --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | OpenRouter AI SDK provider |
| `openai` | `OPENAI_API_KEY` | OpenAI Responses |
| `anthropic` | `ANTHROPIC_API_KEY` | Anthropic Messages |
| `opencode` | `OPENCODE_API_KEY` | OpenCode OpenAI Chat Completions |
| `opencode-responses` | `OPENCODE_API_KEY` | OpenCode OpenAI Responses |
| `opencode-anthropic` | `OPENCODE_API_KEY` | OpenCode Anthropic Messages |

Keys come **only from `ctx.env`**, not an SDK's implicit `process.env`. Use local `.env` bindings during development and Wrangler secret bindings in production. Only the selected candidate's key is required. Missing primary credentials may select a configured backup; an unknown provider/configuration does not silently fall back.

OpenCode endpoints follow its [current inference API](https://opencode.ai/v2/docs/console/api/inference/). Choose the family appropriate to the model. OpenCode's free-tier chat models are restricted to its own client; third-party clients need paid models or a suitable subscription.

Other OpenAI-compatible services can be registered without changing the runner:

```ts
providers: {
  custom: {
    type: 'compatible',
    baseURL: 'https://models.example.com/v1',
    apiKeyEnv: 'CUSTOM_API_KEY',
  },
  directChat: {
    type: 'openai', api: 'chat', apiKeyEnv: 'OPENAI_API_KEY',
  },
}
```

Provider definitions also support `openrouter`, `openai` and `anthropic` types with optional HTTPS `baseURL`. Trusted application integrations can supply a custom `resolve(spec, env, providers)` to `createAI` for other Workers-compatible AI SDK language models.

## Checked mutations and read tools

```ts
import { operationTool } from '@workcore/ai';

const assistant = app.agent({
  input: z.object({ message: z.string() }),
  output: z.object({ text: z.string() }),
  tools: [myTasks, createTask],
  maxSteps: 60,
  handler: async (ctx, input) => {
    const result = await ai.run(ctx, {
      profile: 'planning',
      system: 'Help the user. Only create tasks when explicitly requested.',
      messages: [{ role: 'user', content: input.message }],
      tools: {
        listTasks: operationTool(ctx, 'read', myTasks, 'Read my task page.'),
        createTask: operationTool(ctx, 'mutate', createTask, 'Create a task.'),
      },
      // Optional: selectProfile: turn => turn === 1 ? 'planning' : 'writing',
    });
    return { text: result.text };
  },
});
```

`operationTool` retains the actual registered operation reference. Reads/mutations still enforce current actor authority, input/output schemas, agent allowlists and the normal transactional mutation path. Tools execute sequentially, so a later tool sees prior committed writes. A denied or failed tool fails the agent; it is not silently returned to the model as a success and does not activate model fallback.

Each inference attempt and each tool invocation uses `ctx.step()`. Checked operations additionally consume their own runner step budget. Allow enough `maxSteps` for these nested records; the existing hard cap remains 100. Large model/tool outputs are rejected by the runner's 32 KiB step-result limit. Return bounded results, not an entire database or SDK response.

## Terminating tools and structured completion

Ordinary tool-only responses mean “execute, then continue.” To finish an agent without another model request, explicitly mark a tool as terminating:

```ts
import { terminatingTool, operationTool } from '@workcore/ai';

tools: {
  submitReport: terminatingTool(
    operationTool(ctx, 'mutate', saveReport, 'Save the report and finish. Call this tool alone.'),
    { text: result => `Saved report ${(result as { id: string }).id}.` },
  ),
}
```

The optional `text` function is application-authored display text derived from the successful result. Omit it for structured-only completion. `externalTool` definitions also accept `terminal: true` and an optional `completionText(result)` callback; the wrapper works with either external or checked tools and preserves operation checks.

`ai.run()` returns a discriminated result:

```ts
const outcome = await ai.run(ctx, options);
if (outcome.finishReason === 'tool') {
  // outcome.tool = { name: 'submitReport', result: <JSON tool result> }
  // Persist/return outcome.tool as the job's structured outcome.
  // outcome.text is application-authored text, or '' when not supplied.
} else {
  // outcome.finishReason === 'text'; outcome.text is the final model answer.
}
```

The application handler still declares its output schema and chooses what to return/persist. For chat, save a message only if the completion has display text (or if the terminating tool itself saved the reply); never synthesize an empty/fake assistant answer or save a reply twice. The tracker demonstrates a `submitReply` terminating tool that saves a checked reply once. Scheduled agents can simply return the structured tool outcome.

Safety rules:

- Termination is trusted tool configuration, never inferred from the tool name, result, model prose or an ordinary tool-only response.
- The terminating call must be the **only call in its model response**. Mixed calls, including multiple terminating calls, fail with `AI_TERMINAL_CONFLICT` before any tool executes, regardless of ordering.
- A successful terminating tool is allowed on the last permitted turn; it needs no follow-up inference. Token/deadline/runner-step budgets still apply.
- Failed, denied, invalid or cancelled tools do not produce successful completion or activate model fallback. Successful effects are still not rolled back by later cancellation or a failed display-text formatter.
- The normal trace retains the result; progress records `{ completion: { kind: 'tool', tool: 'submitReport' } }`. Chat/run inspection show **completed via submitReport** only for a completed run. A supplied model text fragment is ignored for the final tool outcome.

### Requiring tool completion

```ts
const outcome = await ai.run(ctx, {
  profile: 'planning',
  completion: 'tool-required',
  system: 'Produce and save a report.',
  messages,
  tools: { submitReport: terminatingTool(reportTool) },
});
```

`completion` is a per-run execution policy:

- **`'text-or-tool'`** (default): either a final text answer or a successful terminating tool completes the loop. Merely defining a terminating tool does not disable text completion.
- **`'tool-required'`**: only a successful terminating tool completes it. At least one terminating tool must be configured; otherwise `AI_CONFIG` is raised before inference. The system instructions describe this requirement. A normal text-only response is retained as intermediate context, followed by an application-generated reminder and another turn—not accepted as a final answer or published as a chat reply.

The policy does not change with model profile selection or provider fallback. Every text-only attempt consumes the normal turn, reported-token, step and deadline budgets. Reaching the turn limit without successful termination raises `AI_TURN_LIMIT`; token exhaustion, cancellation and other failures keep their existing error codes. Ordinary tools still continue the loop, and mixed terminating-tool batches are still rejected before execution.

Progress includes `completionMode` and uses `awaiting-termination` when a text-only answer is declined. The admin labels tool-required runs. The tracker selects this policy so a successful real-model run must save its reply via `submitReply`; offline demo mode remains deterministic.

## External tools

```ts
import { externalTool } from '@workcore/ai';

const lookup = externalTool({
  description: 'Look up an approved reference.',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }, signal) => {
    const response = await fetch(`https://trusted.example.com/items/${encodeURIComponent(id)}`, { signal });
    if (!response.ok) throw new Error('Lookup failed');
    const value = await response.json();
    return { title: String((value as { title: string }).title) };
  },
});
```

Explicitly supplied external tools are trusted application code, not registered database operations. They are validated and traced but must implement their own access checks, outbound host restrictions and side-effect policy. They must honour the abort signal to cancel in-flight work. Never hand a model unrestricted shell, arbitrary-URL fetch or unscoped database access.

## Safe fallback boundary

Each turn requests a model response **without SDK tool execution callbacks**. After a response is accepted and recorded, Workcore executes its tool calls, appends their results to the in-memory conversation, and requests the next turn.

If an inference request has a retryable provider/network error, HTTP 401/403, or missing credentials, its configured backup receives the same messages and tools. Each candidate is attempted once (`maxRetries: 0`). Invalid requests, schema failures, denied tools, tool errors, cancellation, deadlines and exhausted limits do not trigger backup. Later turns start with their profile's primary again.

No whole-loop retry happens. An inference request can still have been billed even when its response was lost. Usage from such a failed request is unknown; switching providers is not a billing rollback. Cross-provider fallback assumes both configured models support the same ordinary tool/text capabilities.

## Tracking, limits and cancellation

The run's JSON `progress` records phase, current turn, selected profile/model, token counts and backup attempts. Chat and run detail show these fields. The timeline records individual model attempts, validated tool outputs, durations and failed attempts. Raw SDK responses, HTTP headers and provider error bodies are not persisted; provider failures use a stable `AI_MODEL_FAILED` error. Tool outputs and model-generated tool inputs are ordinary application data: keep secrets out of them.

- Default limits: **8 turns**, **2048 output tokens/request**, **32,000 reported total tokens**, **120 seconds**. Maximum configurable values are 30 turns, 32,000 output tokens/request, 1,000,000 total tokens and 600 seconds.
- Token totals sum each successful request's reported input/output usage, including repeated conversation context. This is a post-response stop threshold, **not a hard billing/currency cap**; the last input request can exceed it, and some providers may omit usage.
- On the last allowed turn, ordinary tool calls are rejected before execution rather than performing writes with no chance for a final response. A single explicitly terminating tool may complete directly.
- Cancellation now aborts the active run signal and propagates to inference/external tools. Already committed mutations and external effects are not undone. Non-cooperative external code cannot be forcibly stopped by an abort signal.
- A non-normal model finish (e.g. output truncation) fails with `AI_INCOMPLETE` rather than reporting a completed answer.

Object reconstruction still marks active agents **interrupted**. There is no restart, checkpoint replay, tool deduplication across explicit retries, or automatic resumption. Inspect effects before requesting a fresh run. Token streaming and human approval gates are separate future features.

## Tracker example

```dotenv
WORKCORE_AGENT_MODEL=openrouter/anthropic/claude-sonnet-4.5
WORKCORE_AGENT_FALLBACK_MODEL=openai/gpt-4.1-mini
OPENROUTER_API_KEY=...
OPENAI_API_KEY=...
```

The format is `provider/model`; OpenRouter IDs retain their own slash. With no `WORKCORE_AGENT_MODEL`, or `WORKCORE_AI_MODE=demo`, the example returns an explicitly labelled offline demo. A configured model failure is **not** converted into a demo answer. Tests force demo mode and mock SDK models; they never need paid provider calls.

Put these settings in root `.env` or `examples/tracker/.env`, or export them in the shell before `pnpm dev`. Precedence is shell > example > root. The launcher explicitly forwards the selected bindings to Wrangler through a private temporary file; it does not assume that ordinary shell variables automatically become `ctx.env` bindings, and does not forward unrelated shell secrets. Restart `pnpm dev` after changing settings. Never prefix provider keys with `VITE_`.

`WORKCORE_AI_MODE=model` requires a primary model rather than falling into demo mode when it is missing. Unknown modes, malformed/unknown providers and a backup configured without a primary fail explicitly. Each selected candidate's provider key must be available; a backup can still succeed if only its key is configured. Existing model values without the `openrouter/` prefix need updating if they are intended for OpenRouter.

The example exposes checked list/create/edit/complete tools. Its `submitReply` is a terminating **checked mutation tool**, not an application-specific loop: the mutation atomically saves the reply and latest summary and returns display text. There is no second reply or follow-up inference. Direct enqueueing uses the same agent; chat additionally stores the user message and anchors the agent's history to it. Invalid/foreign chat anchors fail before inference. It retains bounded per-user history and no automatic restart policy.

For production, put non-secret selections in Worker vars and upload only the provider keys you use with `pnpm --filter @workcore/example exec wrangler secret put OPENROUTER_API_KEY --env=''` (and similarly for a backup provider). This does not make the example production-ready: its demo authentication must be replaced before public deployment.

## Useful next improvements

Before granting higher-impact capabilities, add application-specific approval gates, task-specific evaluations and adversarial prompt-injection tests. Monetary quotas, per-user rate limits, history compaction, structured outputs and provider capability validation are useful additions. They are not implied by using AI SDK or a Durable Object.
