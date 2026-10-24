import type { Actor, AgentRun, ApplicationRegistration, ExecutionContext, HistoryEntry, OperationCaller, PlatformOptions, PlatformServices, RequestContext, RuntimeOperation, Scope, WireCodec, WorkcoreEvent } from '../index.js';
import { authoriseOperation } from './authorization.js';
import { safeMessage, WorkcoreError } from './errors.js';
import { cleanupContext, consoleLogger, executeWithDeadline, randomId, safeHistory } from './lifecycle.js';
import { operationAt, validate, validateOutput } from './schema.js';
import { encodeResult, encodeWithCodec } from './wire.js';

export type OperationExecution = {
  registration: ApplicationRegistration;
  actor: Actor;
  scope: Scope;
  correlationId: string;
  signal: AbortSignal;
  codec: WireCodec;
  causationId?: string | undefined;
  triggerDepth?: number | undefined;
  runId?: string | undefined;
  request?: RequestContext | undefined;
};

export function createExecutionContext(scope: Scope, actor: Actor, correlationId: string, app: unknown, services: PlatformServices, signal: AbortSignal, runId?: string, request?: RequestContext): ExecutionContext<unknown> {
  return { scope, actor, correlationId, signal, app,
    ...(request ? { request: { ...request, headers: new Headers(request.headers) } } : {}),
    services: {
      kv: {
        get: async (key) => services.kv.get(scope, key) as Promise<never>,
        set: (key, value) => services.kv.set(scope, key, value),
        delete: (key) => services.kv.delete(scope, key),
      },
      logger: services.logger ?? consoleLogger,
      tasks: { reportProgress: (percent) => runId ? services.tasks.progress(runId, percent) : Promise.resolve() },
    },
  };
}

/** The common handler boundary for interactive calls and already-validated queued inputs. */
export async function executeHandler(call: OperationExecution, options: PlatformOptions, def: RuntimeOperation, input: unknown, mode: 'interactive' | 'background' = 'interactive') {
  let context: unknown;
  try {
    context = await call.registration.createAppContext({ actor: call.actor, scope: call.scope });
    const timeout = mode === 'background' ? options.backgroundTimeoutMs ?? options.operationTimeoutMs ?? 5 * 60_000 : options.interactiveTimeoutMs ?? options.operationTimeoutMs ?? 30_000;
    const result = await executeWithDeadline(call.signal, timeout, (signal) => def.handler({
      ctx: createExecutionContext(call.scope, call.actor, call.correlationId, context, options.services, signal, mode === 'background' ? call.runId : undefined, call.request),
      input, operations: createCaller({ ...call, signal }, options),
    }));
    return await validateOutput(def.output, result);
  } finally { await cleanupContext(context, options.services.logger); }
}

export async function executeInteractive(call: OperationExecution, options: PlatformOptions, def: RuntimeOperation, name: string, input: unknown, boundary: 'http' | 'internal') {
  const { actor, scope, correlationId, registration, codec } = call;
  const executionId = randomId();
  const startedAt = Date.now();
  const entry: HistoryEntry = { id: executionId, scope, actorId: actor.id, kind: def.kind, operation: name, status: 'running', startedAt: new Date(startedAt).toISOString() };
  try {
    // Sibling calls retain parent provenance but use the interactive deadline and no task progress.
    const result = await executeHandler(call, options, def, input);
    if (boundary === 'http') encodeResult(codec, result, options);
    const deliveryWarnings: string[] = [];
    if (def.kind === 'mutation') {
      const cause = call.runId ?? call.causationId;
      const event: WorkcoreEvent = { id: randomId(), type: 'mutation.succeeded', ...scope, operation: name, executionId, actorId: actor.id, correlationId,
        ...(cause ? { causationId: cause } : {}),
        ...(boundary === 'internal' ? { triggerDepth: (call.triggerDepth ?? 0) + 1 } : {}),
        createdAt: new Date().toISOString() };
      let published = false;
      try { await options.services.events.publish(event); published = true; }
      catch (error) {
        deliveryWarnings.push('EVENT_DELIVERY_FAILED');
        options.services.logger?.error('Mutation committed but success event publication failed', { executionId, detail: error instanceof Error ? error.message : String(error) });
      }
      if (published) {
        try { await enqueueTriggeredTasks(registration, actor, scope, correlationId, event, options, codec); }
        catch (error) {
          deliveryWarnings.push('TRIGGER_DELIVERY_FAILED');
          options.services.logger?.error('Mutation committed but triggered task enqueue failed', { executionId, detail: safeMessage(error) });
        }
      }
    }
    entry.status = deliveryWarnings.length ? 'delivery_failed' : 'succeeded';
    entry.finishedAt = new Date().toISOString();
    entry.durationMs = Date.now() - startedAt;
    if (!await safeHistory(options, entry)) deliveryWarnings.push('HISTORY_PERSISTENCE_FAILED');
    return { result, executionId, deliveryWarnings };
  } catch (error) {
    entry.status = 'failed';
    entry.finishedAt = new Date().toISOString();
    entry.durationMs = Date.now() - startedAt;
    entry.error = { code: error instanceof WorkcoreError ? error.code : 'EXECUTION_FAILED', message: safeMessage(error) };
    await safeHistory(options, entry);
    throw error;
  }
}

export function createCaller(call: OperationExecution, options: PlatformOptions): OperationCaller {
  const { registration, actor, scope, correlationId, signal, codec, causationId, runId: currentExecutionId, triggerDepth = 0 } = call;
  const invoke = async (kind: 'query' | 'mutation' | 'task', name: string, input: unknown) => {
    if (signal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Operation call was aborted', 499);
    if (!await options.services.workspaces.canAccess(actor, scope)) throw new WorkcoreError('FORBIDDEN', 'Workspace access denied', 403);
    const def = operationAt(registration.definition, kind, name);
    if (!def) throw new WorkcoreError('OPERATION_NOT_FOUND', `Unknown ${kind}: ${name}`, 404);
    const validInput = await validate(def.input, input);
    await authoriseOperation(registration, def, actor, scope, validInput, options);
    if (kind === 'task') {
      if (triggerDepth >= 8) throw new WorkcoreError('TRIGGER_DEPTH_EXCEEDED', 'Background operation trigger depth limit exceeded', 409);
      if (signal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Task enqueue was aborted', 499);
      const id = randomId();
      await options.services.tasks.enqueue({ id, ...scope, operation: name, operationVersion: def.version ?? 1, input: encodeWithCodec(codec, validInput), codecId: codec.id, actorId: actor.id, correlationId,
        ...(currentExecutionId ? { causationId: currentExecutionId } : causationId ? { causationId } : {}), triggerDepth: triggerDepth + 1, createdAt: new Date().toISOString() });
      return { runId: id };
    }
    return (await executeInteractive(call, options, def, name, validInput, 'internal')).result;
  };
  return {
    query: (name, input) => invoke('query', name, input),
    mutate: (name, input) => invoke('mutation', name, input),
    enqueue: (name, input) => invoke('task', name, input) as Promise<{ runId: string }>,
    enqueueAgent: (name, input, agentOptions) => enqueueAgentRun(call, options, name, input, agentOptions?.conversationId),
  };
}

async function enqueueAgentRun(call: OperationExecution, options: PlatformOptions, name: string, rawInput: unknown, conversationId?: string) {
  const { registration, actor, scope, correlationId, codec, signal, runId: causationId, triggerDepth = 0 } = call;
  if (signal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Agent enqueue was aborted', 499);
  if (triggerDepth >= 8) throw new WorkcoreError('TRIGGER_DEPTH_EXCEEDED', 'Background operation trigger depth limit exceeded', 409);
  const definition = registration.definition.agents?.[name];
  if (!definition) throw new WorkcoreError('OPERATION_NOT_FOUND', `Unknown agent: ${name}`, 404);
  if (!options.services.agentRuns) throw new WorkcoreError('AGENT_STORAGE_UNAVAILABLE', 'Agent run storage is not configured', 503);
  const input = await validate(definition.input, rawInput);
  await authoriseOperation(registration, definition, actor, scope, input, options);
  if (!await options.services.workspaces.canAccess(actor, scope)) throw new WorkcoreError('FORBIDDEN', 'Workspace access denied', 403);
  if (signal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Agent enqueue was aborted', 499);
  const id = randomId();
  const createdAt = new Date().toISOString();
  const run: AgentRun = { id, scope, actorId: actor.id, agent: name, status: 'queued', createdAt, correlationId, codecId: codec.id, ...(conversationId ? { conversationId } : {}) };
  await options.services.agentRuns.create(run);
  try {
    if (signal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Agent enqueue was aborted', 499);
    await options.services.tasks.enqueue({ id, ...scope, operation: `@workcore/agent/${name}`, operationVersion: definition.version ?? 1, input: encodeWithCodec(codec, input), codecId: codec.id, actorId: actor.id, correlationId, ...(causationId ? { causationId } : {}), triggerDepth: triggerDepth + 1, createdAt });
  } catch (error) {
    run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = { code: 'AGENT_ENQUEUE_FAILED', message: safeMessage(error) };
    await options.services.agentRuns.update(run);
    throw error;
  }
  return { runId: id };
}

async function enqueueTriggeredTasks(registration: ApplicationRegistration, actor: Actor, scope: Scope, correlationId: string, event: WorkcoreEvent, options: PlatformOptions, codec: WireCodec) {
  if ((event.triggerDepth ?? 0) >= 8) throw new WorkcoreError('TRIGGER_DEPTH_EXCEEDED', 'Task trigger depth limit exceeded', 409);
  if (!await options.services.workspaces.canAccess(actor, scope)) throw new WorkcoreError('FORBIDDEN', 'Workspace access denied before triggered task enqueue', 403);
  for (const [operation, definition] of Object.entries(registration.definition.tasks ?? {})) {
    if (!definition.triggers?.mutations?.includes(event.operation ?? '')) continue;
    const input = await validate(definition.input, definition.triggers.mapInput ? definition.triggers.mapInput(event) : {});
    await authoriseOperation(registration, definition, actor, scope, input, options);
    await options.services.tasks.enqueue({ id: randomId(), ...scope, operation, operationVersion: definition.version ?? 1, input: encodeWithCodec(codec, input), codecId: codec.id, actorId: actor.id, correlationId, causationId: event.id, triggerDepth: (event.triggerDepth ?? 0) + 1, createdAt: new Date().toISOString() });
  }
}
