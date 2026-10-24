import type { AgentRun, AgentRunStatus, AgentTraceEvent, DefinitionAt, HistoryEntry, InputFor, OutputFor, PublicOperationNames, ScheduleEntry, TaskRun, ValidationIssue, OperationViews as CoreOperationViews, SemanticInterfaceDocument } from '@workcore/core';
import { jsonWireCodec, type JsonValue, type WireCodec } from '@workcore/core';

export type TransportRequest = {
  path: 'query' | 'mutate' | 'enqueue';
  applicationId: string;
  workspaceId: string;
  operation: string;
  input: unknown;
  signal?: AbortSignal;
  correlationId?: string;
};

export type OperationResponse<T> = { result: T; executionId?: string; correlationId?: string; deliveryWarnings: string[] };
export type CallOptions = Pick<TransportRequest, 'signal' | 'correlationId'>;

export type WorkcoreTransport = {
  request<T>(request: TransportRequest): Promise<T>;
  requestDetailed?<T>(request: TransportRequest): Promise<OperationResponse<T>>;
  manifest(applicationId: string, workspaceId: string): Promise<WorkcoreManifest>;
  applications(): Promise<Array<{ id: string; workspaceCount: number }>>;
  workspaces(applicationId: string): Promise<Array<{ id: string; name: string }>>;
  subscribe(applicationId: string, workspaceId: string, callbacks: { onInvalidate(): void; onReady?(): void; onReconnect?(): void; onError(error: Error): void }): () => void;
  /** Fixed, capability-checked platform resources. Implementations must not accept caller-selected URLs. */
  resources?: WorkcoreResourceAdapters;
  agentRuns?(applicationId: string, workspaceId: string, filter?: AgentRunFilter): Promise<{ runs: AgentRun[]; nextCursor: string | null }>;
  agentRun?(applicationId: string, workspaceId: string, runId: string): Promise<AgentRun>;
  agentRunEvents?(applicationId: string, workspaceId: string, runId: string, after?: number, limit?: number): Promise<{ events: AgentTraceEvent[]; nextCursor: string | null }>;
};

export type PublicTaskRun = Omit<TaskRun, 'result'> & { result?: unknown };
export type PublicSchedule = Omit<ScheduleEntry, 'input' | 'claimToken' | 'claimUntil' | 'pendingRunId'> & { input: unknown };
export type ScheduleCreateInput = {
  operation: string;
  input: unknown;
  timezone: string;
} & ({ kind: 'once'; runAt: string } | { kind: 'recurring'; cron: string });
export type ScheduleUpdateInput = { enabled?: boolean; timezone?: string; cron?: string };

/** Allow-listed built-in resource adapters. Server endpoints remain authoritative for access and input checks. */
export type WorkcoreResourceAdapters = {
  taskRuns(applicationId: string, workspaceId: string, limit?: number): Promise<{ runs: PublicTaskRun[] }>;
  history(applicationId: string, workspaceId: string, limit?: number): Promise<{ entries: HistoryEntry[] }>;
  schedules(applicationId: string, workspaceId: string): Promise<{ schedules: PublicSchedule[] }>;
  createSchedule(applicationId: string, workspaceId: string, input: ScheduleCreateInput): Promise<{ schedule: PublicSchedule }>;
  updateSchedule(applicationId: string, workspaceId: string, id: string, patch: ScheduleUpdateInput): Promise<{ schedule: PublicSchedule }>;
  deleteSchedule(applicationId: string, workspaceId: string, id: string): Promise<{ ok: true }>;
};

export type AgentRunFilter = { limit?: number; cursor?: string; agent?: string; status?: AgentRunStatus; actorId?: string; conversationId?: string };

export type WorkcoreManifest = {
  protocolVersion: 2;
  schemaDialect?: string;
  applicationId: string;
  operations: Array<{
    name: string;
    kind: 'query' | 'mutation' | 'task';
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  }>;
  interface: SemanticInterfaceDocument;
  capabilities?: {
    tasksRead: boolean; schedulesRead: boolean; schedulesManage: boolean; historyRead: boolean;
    agentRunsRead: boolean; agentRunsReadAll: boolean; agentResultsRead: boolean; agentMessagesRead: boolean; agentToolsRead: boolean; agentToolPayloadsRead: boolean;
  };
};
export type OperationViews = CoreOperationViews;

const semanticFeatures = new Set(['operation-views-v1', 'collection-editor-v1', 'operation-catalog-v1', 'custom-placeholder-v1']);
const unsafeSemanticPathTokens = new Set(['__proto__', 'prototype', 'constructor']);

/** Validate the canonical semantic contract before a renderer interprets its descriptors. */
export function validateSemanticInterface(manifest: WorkcoreManifest): SemanticInterfaceDocument {
  const document = manifest.interface;
  if (manifest.protocolVersion !== 2 || !document || document.version !== 1 || !Array.isArray(document.requiredFeatures) || !Array.isArray(document.pages) || !Array.isArray(document.operationViews)) {
    throw new WorkcoreClientError('UNSUPPORTED_INTERFACE', 'Malformed or unsupported semantic interface document', 400);
  }
  const unsupported = document.requiredFeatures.find((feature) => typeof feature !== 'string' || !semanticFeatures.has(feature));
  if (unsupported) throw new WorkcoreClientError('UNSUPPORTED_INTERFACE_FEATURE', `Unsupported required semantic UI feature '${String(unsupported)}'`, 400);
  const pageIds = new Set<string>();
  let containsCollection = false;
  for (const page of document.pages) {
    if (!page || typeof page.id !== 'string' || !page.id || !page.title || !Array.isArray(page.blocks) || pageIds.has(page.id)) {
      throw new WorkcoreClientError('INVALID_INTERFACE', 'Semantic pages require unique IDs, titles, and block arrays', 400);
    }
    pageIds.add(page.id);
    for (const [stateName, state] of Object.entries(page.state ?? {})) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(stateName) || unsafeSemanticPathTokens.has(stateName) || !state || typeof state.label !== 'string' || !state.label || typeof state.default !== 'string') throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' has an invalid state declaration`, 400);
      if (state.type === 'text') continue;
      if (state.type !== 'select' || !Array.isArray(state.options) || !state.options.length) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' state '${stateName}' has an unsupported declaration`, 400);
      const optionValues = new Set<string>();
      for (const option of state.options) {
        if (!option || typeof option.value !== 'string' || typeof option.label !== 'string' || optionValues.has(option.value)) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' state '${stateName}' has invalid or duplicate select options`, 400);
        optionValues.add(option.value);
      }
      if (!optionValues.has(state.default)) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' state '${stateName}' has a default outside its select options`, 400);
    }
    const blockIds = new Set<string>();
    const catalogSelections = new Set<string>();
    const executorSelections = new Set<string>();
    for (const block of page.blocks) {
      if (!block || typeof block.id !== 'string' || !block.id || blockIds.has(block.id)) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' contains a missing or duplicate block ID`, 400);
      blockIds.add(block.id);
      if (block.type === 'query') {
        const query = manifest.operations.find((operation) => operation.kind === 'query' && operation.name === block.operation);
        if (!query) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' references unavailable query '${block.operation}'`, 400);
        const operationView = document.operationViews.find((view) => view.operation === block.operation && view.kind === 'query');
        const hasOperationVariant = Boolean(block.variant && operationView && Object.hasOwn(operationView.variants, block.variant));
        if (block.variant && !hasOperationVariant) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' references unavailable query variant '${block.operation}/${block.variant}'`, 400);
        if (block.inputBindings) {
          const inputSchema = query.input && typeof query.input === 'object' ? query.input as { properties?: Record<string, { type?: unknown; enum?: unknown }>; required?: string[] } : {};
          if (typeof block.inputBindings !== 'object' || Array.isArray(block.inputBindings)) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' query has invalid state bindings`, 400);
          for (const [target, binding] of Object.entries(block.inputBindings as Record<string, unknown>)) {
            const stateName = binding && typeof binding === 'object' && 'state' in binding && typeof binding.state === 'string' ? binding.state : undefined;
            const state = stateName && Object.hasOwn(page.state ?? {}, stateName) ? page.state?.[stateName] : undefined;
            const targetSchema = inputSchema.properties?.[target];
            if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(target) || unsafeSemanticPathTokens.has(target) || !state || !targetSchema || targetSchema.type !== 'string') throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' has an invalid state binding for query input '${target}'`, 400);
            if (state.type === 'select') {
              const required = inputSchema.required?.includes(target) ?? false;
              const enumValues = Array.isArray(targetSchema.enum) ? new Set(targetSchema.enum.filter((value): value is string => typeof value === 'string')) : undefined;
              if (!enumValues || state.options.some((option) => option.value !== '' && !enumValues.has(option.value)) || (required && state.options.some((option) => option.value === ''))) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' select state '${stateName}' is incompatible with query input '${target}'`, 400);
            }
          }
        }
      } else if (block.type === 'mutation-form' && !manifest.operations.some((operation) => operation.kind === 'mutation' && operation.name === block.operation)) {
        throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' references unavailable mutation '${block.operation}'`, 400);
      } else if (block.type === 'task-launcher' && !manifest.operations.some((operation) => operation.kind === 'task' && operation.name === block.operation)) {
        throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' references unavailable task '${block.operation}'`, 400);
      } else if (block.type === 'custom') {
        if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\/[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(block.component) || !Number.isSafeInteger(block.version) || block.version < 1 || (block.title !== undefined && typeof block.title !== 'string') || (block.description !== undefined && typeof block.description !== 'string') || (block.props !== undefined && !isSemanticJson(block.props))) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' has an invalid custom component descriptor`, 400);
      } else if (block.type === 'resource') {
        if (!['tasks', 'schedules', 'history', 'agents'].includes(block.resource)) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' references an unsupported resource`, 400);
      } else if (block.type === 'operation-catalog' || block.type === 'operation-executor') {
        if (typeof block.selection !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(block.selection) || unsafeSemanticPathTokens.has(block.selection)) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' has an invalid operation selection reference`, 400);
        const selections = block.type === 'operation-catalog' ? catalogSelections : executorSelections;
        if (selections.has(block.selection)) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' repeats operation selection '${block.selection}'`, 400);
        selections.add(block.selection);
       } else if (block.type !== 'query' && block.type !== 'mutation-form' && block.type !== 'task-launcher') {
        throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' contains an unsupported semantic block`, 400);
      }
    }
    for (const selection of new Set([...catalogSelections, ...executorSelections])) {
      if (!catalogSelections.has(selection) || !executorSelections.has(selection)) throw new WorkcoreClientError('INVALID_INTERFACE', `Page '${page.id}' operation selection '${selection}' requires one catalog and one executor`, 400);
    }
    if ((catalogSelections.size > 0 || executorSelections.size > 0) && !document.requiredFeatures.includes('operation-catalog-v1')) throw new WorkcoreClientError('INVALID_INTERFACE', 'Operation catalog blocks require the operation-catalog-v1 feature declaration', 400);
    if (page.blocks.some((block) => block.type === 'custom') && !document.requiredFeatures.includes('custom-placeholder-v1')) throw new WorkcoreClientError('INVALID_INTERFACE', 'Custom component blocks require the custom-placeholder-v1 feature declaration', 400);
  }
  if (document.defaultPage !== undefined && !pageIds.has(document.defaultPage)) throw new WorkcoreClientError('INVALID_INTERFACE', 'Semantic defaultPage must reference a declared semantic page', 400);
  const presentationKeys = new Set<string>();
  for (const view of document.operationViews) {
    const operation = manifest.operations.find((candidate) => candidate.kind === view.kind && candidate.name === view.operation);
    const key = `${view.kind}:${view.operation}`;
    if (!operation || presentationKeys.has(key) || !view.variants || !Object.hasOwn(view.variants, view.default)) throw new WorkcoreClientError('INVALID_INTERFACE', `Semantic operation presentation '${key}' is missing, duplicated, or has no default`, 400);
    presentationKeys.add(key);
    for (const [name, variant] of Object.entries(view.variants)) {
      if (!name || !variant || !['table', 'json', 'chart', 'form', 'chat', 'chat-messages', 'chat-threads', 'chat-thread'].includes(variant.renderer) || typeof variant.title !== 'string') throw new WorkcoreClientError('INVALID_INTERFACE', `Semantic operation presentation '${key}/${name}' is malformed`, 400);
      if (variant.renderer === 'chart' && (view.kind !== 'query' || !variant.chart || typeof variant.chart.xField !== 'string' || !variant.chart.xField || typeof variant.chart.yField !== 'string' || !variant.chart.yField || (variant.chart.seriesField !== undefined && typeof variant.chart.seriesField !== 'string'))) throw new WorkcoreClientError('INVALID_INTERFACE', `Semantic chart presentation '${key}/${name}' is malformed`, 400);
      if (variant.collection) {
        containsCollection = true;
        const collection = variant.collection;
        if (view.kind !== 'query' || variant.renderer !== 'table' || !collection.itemKey || collection.itemKey.split('.').some((part) => !part || unsafeSemanticPathTokens.has(part)) || !Array.isArray(collection.columns)) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' has an invalid collection`, 400);
        if (collection.presentation !== undefined && !['responsive', 'table', 'cards'].includes(collection.presentation)) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' has an unsupported collection presentation`, 400);
        if (collection.paginationMode !== undefined && !['cursor', 'offset'].includes(collection.paginationMode)) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' has an unsupported pagination mode`, 400);
        if ([collection.titleField, collection.subtitleField].some((field) => field !== undefined && (typeof field !== 'string' || !field || field.split('.').some((part) => unsafeSemanticPathTokens.has(part))))) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' has an invalid collection field`, 400);
        for (const column of collection.columns) if (!column || typeof column.field !== 'string' || !column.field || column.field.split('.').some((part: string) => !part || unsafeSemanticPathTokens.has(part)) || (column.filter && (!['text', 'select'].includes(column.filter.type) || unsafeSemanticPathTokens.has(column.filter.targetParam ?? column.field)))) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' has an invalid collection column`, 400);
        if (collection.editor) {
          const identity = collection.editor.identity;
          if (identity && (typeof identity.rowField !== 'string' || !identity.rowField || identity.rowField.split('.').some((part) => !part || unsafeSemanticPathTokens.has(part)) || typeof identity.targetInput !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(identity.targetInput) || unsafeSemanticPathTokens.has(identity.targetInput))) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' has an invalid editor identity mapping`, 400);
          if (!manifest.operations.some((operation) => operation.kind === 'mutation' && operation.name === collection.editor!.mutation)) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' references unavailable editor mutation`, 400);
        }
        for (const action of collection.actions ?? []) {
          if (!action.label || !manifest.operations.some((operation) => operation.kind === 'mutation' && operation.name === action.mutation)) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' references unavailable row action mutation`, 400);
          for (const [target, binding] of Object.entries(action.bind ?? {})) {
            const fromRow = binding && typeof binding === 'object' && 'fromRow' in binding ? binding.fromRow : undefined;
            if (unsafeSemanticPathTokens.has(target) || typeof fromRow !== 'string' || !fromRow || fromRow.split('.').some((part: string) => !part || unsafeSemanticPathTokens.has(part))) throw new WorkcoreClientError('INVALID_INTERFACE', `Operation presentation '${key}/${name}' has an unsafe row action mapping`, 400);
          }
        }
      }
    }
  }
  if (presentationKeys.size !== manifest.operations.length) throw new WorkcoreClientError('INVALID_INTERFACE', 'Every exposed operation must have one semantic operation presentation', 400);
  if (document.operationViews.length > 0 && !document.requiredFeatures.includes('operation-views-v1')) throw new WorkcoreClientError('INVALID_INTERFACE', 'Operation presentations require the operation-views-v1 feature declaration', 400);
  if (containsCollection && !document.requiredFeatures.includes('collection-editor-v1')) throw new WorkcoreClientError('INVALID_INTERFACE', 'Collection descriptors require the collection-editor-v1 feature declaration', 400);
  return document;
}

function isSemanticJson(value: unknown, seen = new WeakSet<object>(), depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 64 || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isSemanticJson(entry, seen, depth + 1))
    : Object.entries(value).every(([key, entry]) => !unsafeSemanticPathTokens.has(key) && isSemanticJson(entry, seen, depth + 1));
  seen.delete(value);
  return valid;
}

export type SubscriptionSource = Pick<EventSource, 'onopen' | 'onmessage' | 'onerror' | 'close'>;
export type FetchTransportOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  eventSource?: (url: string, init: EventSourceInit) => SubscriptionSource;
  onWarning?: (code: string) => void;
  codec?: WireCodec;
};

export function createFetchTransport(options: FetchTransportOptions = {}): WorkcoreTransport {
  const fetcher = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? '/workcore/api').replace(/\/$/, '');
  const codec = options.codec ?? jsonWireCodec;
  if (!codec.id) throw new TypeError('Wire codecs must provide a non-empty id');
  if (codec.id === jsonWireCodec.id && codec !== jsonWireCodec) throw new TypeError("The 'json' codec id is reserved for jsonWireCodec");
  async function json<T>(url: string, init?: RequestInit, readHeaders?: (headers: Headers, status: number) => void): Promise<T> {
    const headers = new Headers(typeof options.headers === 'function' ? await options.headers() : options.headers);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set('x-workcore-codec', codec.id);
    const response = await fetcher(url, { credentials: options.credentials ?? 'same-origin', ...init, headers });
    readHeaders?.(response.headers, response.status);
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new WorkcoreClientError('INVALID_RESPONSE', 'Server response was not valid JSON', response.status, { correlationId: response.headers.get('x-correlation-id') ?? undefined }); }
    const decode = (payload: JsonValue) => {
      try { return codec.decode(payload); }
      catch { throw new WorkcoreClientError('WIRE_DECODING_FAILED', `Could not decode server response with '${codec.id}'`, response.status, { correlationId: response.headers.get('x-correlation-id') ?? undefined }); }
    };
    if (!response.ok) {
      let decoded = data;
      if (codec.id !== 'json' && isCodecEnvelope(data, codec.id)) decoded = decode(data.payload);
      const payload = decoded && typeof decoded === 'object' ? decoded as { error?: { code?: string; message?: string; correlationId?: string; issues?: ValidationIssue[] } } : {};
      throw new WorkcoreClientError(payload.error?.code ?? 'HTTP_ERROR', payload.error?.message ?? `Request failed (${response.status})`, response.status, {
        correlationId: payload.error?.correlationId ?? response.headers.get('x-correlation-id') ?? undefined,
        issues: payload.error?.issues,
      });
    }
    if (codec.id === 'json') return data as T;
    if (!isCodecEnvelope(data, codec.id)) throw new WorkcoreClientError('WIRE_CODEC_MISMATCH', `Server response did not use '${codec.id}'`, response.status, { correlationId: response.headers.get('x-correlation-id') ?? undefined });
    return decode(data.payload) as T;
  }
  const operationBody = (value: unknown) => {
    if (codec.id === 'json') return JSON.stringify(jsonWireCodec.encode(value));
    const payload = jsonWireCodec.encode(codec.encode(value));
    return JSON.stringify({ workcoreCodec: codec.id, payload });
  };
  const resourceQuery = (applicationId: string, workspaceId: string, limit?: number) => new URLSearchParams({
    applicationId,
    workspaceId,
    ...(limit === undefined ? {} : { limit: String(limit) }),
  });
  const requestDetailed = async <T>({ path, applicationId, workspaceId, operation, input, signal, correlationId }: TransportRequest): Promise<OperationResponse<T>> => {
    let responseCorrelationId: string | undefined;
    let responseStatus = 200;
    const response = await json<unknown>(`${baseUrl}/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(correlationId ? { 'x-correlation-id': correlationId } : {}) },
      ...(signal ? { signal } : {}), body: operationBody({ applicationId, workspaceId, operation, input }),
    }, (headers, status) => { responseCorrelationId = headers.get('x-correlation-id') ?? undefined; responseStatus = status; });
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new WorkcoreClientError('INVALID_RESPONSE', 'Expected an operation response object', responseStatus, { correlationId: responseCorrelationId });
    const envelope = response as Record<string, unknown>;
    if (path === 'enqueue' ? typeof envelope.runId !== 'string' || !envelope.runId : !Object.hasOwn(envelope, 'result') || typeof envelope.executionId !== 'string' || !envelope.executionId) throw new WorkcoreClientError('INVALID_RESPONSE', 'Malformed operation success envelope', responseStatus, { correlationId: responseCorrelationId });
    const warnings = Array.isArray(envelope.deliveryWarnings)
      ? envelope.deliveryWarnings.filter((warning): warning is string => typeof warning === 'string')
      : typeof envelope.deliveryWarning === 'string' ? [envelope.deliveryWarning] : [];
    for (const warning of warnings) options.onWarning?.(warning);
    return {
      result: (path === 'enqueue' ? { runId: envelope.runId } : envelope.result) as T,
      ...(typeof envelope.executionId === 'string' ? { executionId: envelope.executionId } : {}),
      ...(typeof envelope.correlationId === 'string' ? { correlationId: envelope.correlationId } : responseCorrelationId ? { correlationId: responseCorrelationId } : {}),
      deliveryWarnings: warnings,
    };
  };
  return {
    request: async <T>(request: TransportRequest) => (await requestDetailed<T>(request)).result,
    requestDetailed,
    manifest: async (applicationId, workspaceId) => json(`${baseUrl}/manifest?applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}`),
    applications: async () => (await json<{ applications: Array<{ id: string; workspaceCount: number }> }>(`${baseUrl}/applications`)).applications,
    workspaces: async (applicationId) => (await json<{ workspaces: Array<{ id: string; name: string }> }>(`${baseUrl}/workspaces?applicationId=${encodeURIComponent(applicationId)}`)).workspaces,
    resources: {
      taskRuns: async (applicationId, workspaceId, limit = 50) => json(`${baseUrl}/tasks?${resourceQuery(applicationId, workspaceId, limit)}`),
      history: async (applicationId, workspaceId, limit = 50) => json(`${baseUrl}/history?${resourceQuery(applicationId, workspaceId, limit)}`),
      schedules: async (applicationId, workspaceId) => json(`${baseUrl}/schedules?${resourceQuery(applicationId, workspaceId)}`),
      createSchedule: async (applicationId, workspaceId, input) => json(`${baseUrl}/schedules`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: operationBody({ applicationId, workspaceId, ...input }),
      }),
      updateSchedule: async (applicationId, workspaceId, id, patch) => json(`${baseUrl}/schedules/${encodeURIComponent(id)}?${resourceQuery(applicationId, workspaceId)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: operationBody(patch),
      }),
      deleteSchedule: async (applicationId, workspaceId, id) => json(`${baseUrl}/schedules/${encodeURIComponent(id)}?${resourceQuery(applicationId, workspaceId)}`, { method: 'DELETE' }),
    },
    agentRuns: async (applicationId, workspaceId, filter = {}) => json(`${baseUrl}/agent-runs?${new URLSearchParams({ applicationId, workspaceId, ...Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])) })}`),
    agentRun: async (applicationId, workspaceId, runId) => (await json<{ run: AgentRun }>(`${baseUrl}/agent-runs/${encodeURIComponent(runId)}?applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}`)).run,
    agentRunEvents: async (applicationId, workspaceId, runId, after = 0, limit = 50) => json(`${baseUrl}/agent-runs/${encodeURIComponent(runId)}/events?applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}&after=${after}&limit=${limit}`),
    subscribe: (applicationId, workspaceId, callbacks) => {
      if (!options.eventSource && options.credentials === 'omit') throw new TypeError('Native EventSource cannot omit same-origin cookies; supply eventSource for this credential policy');
      const factory = options.eventSource ?? ((url: string, init: EventSourceInit) => new EventSource(url, init));
      const source = factory(`${baseUrl}/events?applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}`, { withCredentials: options.credentials === 'include' });
      let connected = false;
      source.onopen = () => { if (connected) callbacks.onReconnect?.(); else callbacks.onReady?.(); connected = true; };
      source.onmessage = (message) => {
        try { const event = JSON.parse(message.data) as { type?: string }; if (event.type === 'invalidate' || event.type === 'refresh') callbacks.onInvalidate(); }
        catch { callbacks.onError(new Error('Received invalid event data')); }
      };
      source.onerror = () => callbacks.onError(new Error('Live connection interrupted; reconnecting'));
      return () => source.close();
    },
  };
}

export class WorkcoreClientError extends Error {
  readonly correlationId: string | undefined;
  readonly issues: ValidationIssue[] | undefined;
  constructor(readonly code: string, message: string, readonly status: number, details: { correlationId?: string | undefined; issues?: ValidationIssue[] | undefined } = {}) {
    super(message); this.name = 'WorkcoreClientError';
    this.correlationId = details.correlationId;
    this.issues = details.issues;
  }
}

export function createClient<D>(options: { transport: WorkcoreTransport; applicationId: string; workspaceId: string }) {
  const request = <T>(path: 'query' | 'mutate' | 'enqueue', operation: string, input: unknown, call?: CallOptions) => options.transport.request<T>({ path, applicationId: options.applicationId, workspaceId: options.workspaceId, operation, input, ...call });
  const detailed = <T>(path: 'query' | 'mutate' | 'enqueue', operation: string, input: unknown, call?: CallOptions) => {
    if (!options.transport.requestDetailed) throw new TypeError('This transport does not support detailed operation responses');
    return options.transport.requestDetailed<T>({ path, applicationId: options.applicationId, workspaceId: options.workspaceId, operation, input, ...call });
  };
  return {
    query: <N extends PublicOperationNames<D, 'query'>>(operation: N, input: InputFor<DefinitionAt<D, 'query', N>>, call?: CallOptions) => request<OutputFor<DefinitionAt<D, 'query', N>>>('query', operation, input, call),
    mutate: <N extends PublicOperationNames<D, 'mutation'>>(operation: N, input: InputFor<DefinitionAt<D, 'mutation', N>>, call?: CallOptions) => request<OutputFor<DefinitionAt<D, 'mutation', N>>>('mutate', operation, input, call),
    enqueue: <N extends PublicOperationNames<D, 'task'>>(operation: N, input: InputFor<DefinitionAt<D, 'task', N>>, call?: CallOptions) => request<{ runId: string }>('enqueue', operation, input, call),
    queryDetailed: <N extends PublicOperationNames<D, 'query'>>(operation: N, input: InputFor<DefinitionAt<D, 'query', N>>, call?: CallOptions) => detailed<OutputFor<DefinitionAt<D, 'query', N>>>('query', operation, input, call),
    mutateDetailed: <N extends PublicOperationNames<D, 'mutation'>>(operation: N, input: InputFor<DefinitionAt<D, 'mutation', N>>, call?: CallOptions) => detailed<OutputFor<DefinitionAt<D, 'mutation', N>>>('mutate', operation, input, call),
    enqueueDetailed: <N extends PublicOperationNames<D, 'task'>>(operation: N, input: InputFor<DefinitionAt<D, 'task', N>>, call?: CallOptions) => detailed<{ runId: string }>('enqueue', operation, input, call),
    agentRuns: (filter?: AgentRunFilter) => {
      if (!options.transport.agentRuns) throw new Error('This transport does not support built-in agent run inspection');
      return options.transport.agentRuns(options.applicationId, options.workspaceId, filter);
    },
    agentRun: (runId: string) => {
      if (!options.transport.agentRun) throw new Error('This transport does not support built-in agent run inspection');
      return options.transport.agentRun(options.applicationId, options.workspaceId, runId);
    },
    agentRunEvents: (runId: string, after?: number, limit?: number) => {
      if (!options.transport.agentRunEvents) throw new Error('This transport does not support built-in agent run inspection');
      return options.transport.agentRunEvents(options.applicationId, options.workspaceId, runId, after, limit);
    },
    subscribe: <N extends PublicOperationNames<D, 'query'>>(operation: N, input: InputFor<DefinitionAt<D, 'query', N>>, callbacks: { onData(data: OutputFor<DefinitionAt<D, 'query', N>>): void; onError(error: Error): void }) => {
      let disposed = false;
      let inFlight = false;
      let rerun = false;
      const refresh = async () => {
        if (disposed) return;
        if (inFlight) { rerun = true; return; }
        inFlight = true;
        try {
          const value = await request<OutputFor<DefinitionAt<D, 'query', N>>>('query', operation, input);
          if (!disposed && !rerun) callbacks.onData(value);
        } catch (error) { if (!disposed && !rerun) callbacks.onError(error instanceof Error ? error : new Error(String(error))); }
        finally { inFlight = false; if (rerun && !disposed) { rerun = false; void refresh(); } }
      };
      // Subscribe first so invalidations during the initial query are not lost.
      const unsubscribe = options.transport.subscribe(options.applicationId, options.workspaceId, { onInvalidate: () => void refresh(), onReady: () => void refresh(), onReconnect: () => void refresh(), onError: (error) => { if (!disposed) callbacks.onError(error); } });
      void refresh();
      return () => { if (disposed) return; disposed = true; unsubscribe(); };
    },
  };
}

function isCodecEnvelope(value: unknown, id: string): value is { workcoreCodec: string; payload: JsonValue } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { workcoreCodec?: unknown }).workcoreCodec === id && 'payload' in value;
}

export type TypedClient<D> = ReturnType<typeof createClient<D>>;
