# Tasks, schedules and agents

## Tasks

```ts
const finishLater = app.task({
  input: z.object({ id: z.string() }),
  output: taskRowSchema,
  maxAttempts: 1,
  handler: async (ctx, input) => ctx.mutate(completeTask, input),
});
```

Register the job in `jobs`. A mutation can atomically enqueue it with `ctx.enqueue(finishLater, input)`. Clients can enqueue registered jobs through the typed client, subject to the same `job:name` access check.

Run context supplies the initiating actor, environment bindings, run ID, typed references to registered read/mutation operations, and `step(label, execute)` for external work. Passing operation objects preserves input/output inference without introducing a separate string-based tool API.

Jobs access data through operations, not a retained database transaction. Every operation rechecks current authorisation. Mutations called by a job are attributed to its run ID in history.

## Persisted lifecycle

Runs have queued, running, completed, failed, interrupted or cancelled status. Workcore persists the original JSON input, actor, attempts, due time, terminal output/error and recorded steps.

Known task failures may be retried with `maxAttempts` (default 1, runtime maximum 10) and `retryDelayMs` (default 5 seconds, minimum 1 second). Only opt into retries when the handler's external effects are idempotent or otherwise safe to repeat.

Object reconstruction changes previously running runs to `interrupted`; it does not guess whether an email, model call or tool action completed. An admin may inspect and explicitly retry a failed/interrupted/cancelled run. Manual retry creates a **new** run and can repeat effects.

Cancelling a queued run prevents execution. Cancelling a running run sets a request checked before subsequent tools/steps and before completion. It cannot undo an external effect or forcibly abort arbitrary application code already executing.

The runtime executes at most one job at a time per workspace. It does not promise unlimited runtime or bypass Cloudflare's execution limits.

## Schedules

```ts
handler: ({ schedule, now }, input) => ({
  scheduleId: schedule(finishLater, { id: input.id }, {
    at: now + 60_000,
    // everyMs: 3_600_000, // optional fixed interval
  }),
})
```

Schedule creation shares the mutation transaction. Use epoch milliseconds and optional intervals of at least 1 second. Admins can enable/disable schedules; mutations can cancel their actor's schedules.

The current policies are deliberately fixed:

- One-off schedules enqueue once, then disable.
- Missed interval occurrences coalesce into at most one dispatch when processing resumes.
- If that schedule already has a queued/running run, the occurrence is skipped.
- Dispatch and advancing/disabling the schedule commit together.
- Current authorisation and input validation are rechecked at dispatch and execution. Invalid or denied schedules disable instead of spinning indefinitely.
- Disabling a schedule does not cancel an already queued run.

There is no cron syntax, timezone/DST engine, calendar scheduler or general workflow language.

## Agents

```ts
const assistant = app.agent({
  input: z.object({}),
  output: z.object({ text: z.string() }),
  tools: [myTasks, saveSummary],
  maxSteps: 10,
  handler: async ctx => {
    const tasks = ctx.read(myTasks, {});
    const result = await ctx.step('Generate summary', async () => {
      return callYourModel(ctx.env, tasks);
    });
    ctx.mutate(saveSummary, result);
    return result;
  },
});
```

An agent is a job with an explicit operation allowlist and **no automatic retry**. It runs under the initiating actor's current authority, never a special unrestricted agent identity.

Application code owns instructions, model selection and the agent loop. Workcore supplies persistence, checked tools and operational visibility—not an abstract model-provider framework. The tracker demonstrates an optional Workers AI call and a labelled no-model demo fallback.

Each checked tool call and explicit external step consumes the run's `maxSteps` budget (default 20, hard maximum 100). External steps persist intent before execution and completion/failure afterwards. Successful local mutation tool traces commit atomically with their data changes. Tool traces contain metadata, not automatic copies of every input/output. Explicit step results are persisted and may contain sensitive model output.

This is a cooperative execution API, not a sandbox: handlers must route model/external work through `step` and tools through `read`/`mutate`. It does not enforce token/currency budgets or a wall-clock deadline, stream tokens, persist a conversation abstraction, request human approvals, or safely resume arbitrary model loops. Those are future product choices, not existing guarantees.

## Inspection and retention

The console exposes runs, traces, schedules and successful mutation/control history. Owners with `$runs` may inspect their own runs and traces. `$admin` permits all run inspection plus tables, schedules, history and controls. Lists omit potentially large run inputs/results and schedule inputs; `inspect('run:' + id)` or `inspect('schedule:' + id)` returns the authorised detail. Traces are paged ten entries at a time with a numeric `nextCursor`; pass it as the second argument to `client.trace(runId, cursor)`.

The latest 1,000 terminal runs and their traces are retained. Queued/running runs are not pruned. The latest 1,000 history entries and deduplication responses are retained independently. Schedules and application records persist until application management changes them; configurable time-based retention/export is not yet implemented.

Run listing uses cursor pagination. It is ID-ordered, not a chronological feed. Generic history is metadata-first and records successful actions; rolled-back mutation failures are returned to callers, not separately inserted into the failed transaction.
