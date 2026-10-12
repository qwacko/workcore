import type { DefinitionAt, InputFor, OutputFor, QueryNames, MutationNames, TaskNames } from '@workcore/core';
import { jsonWireCodec, type JsonValue, type WireCodec } from '@workcore/core';

export type TransportRequest = {
  path: 'query' | 'mutate' | 'enqueue';
  applicationId: string;
  workspaceId: string;
  operation: string;
  input: unknown;
};

export type WorkcoreTransport = {
  request<T>(request: TransportRequest): Promise<T>;
  manifest(applicationId: string, workspaceId: string): Promise<WorkcoreManifest>;
  applications(): Promise<Array<{ id: string; workspaceCount: number }>>;
  workspaces(applicationId: string): Promise<Array<{ id: string; name: string }>>;
  subscribe(applicationId: string, workspaceId: string, callbacks: { onInvalidate(): void; onReady?(): void; onReconnect?(): void; onError(error: Error): void }): () => void;
};

export type WorkcoreManifest = {
  protocolVersion: number;
  applicationId: string;
  operations: Array<{
    name: string;
    kind: 'query' | 'mutation' | 'task';
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    ui: UiMetadata | null;
  }>;
};
export type UiMetadata = {
  default: string;
  variants: Record<string, {
    title: string;
    subtitle?: string;
    helpText?: string;
    renderer: 'table' | 'json' | 'form';
    rowKey?: string;
    columns?: readonly string[];
    actions?: ReadonlyArray<{
      label: string;
      mutation: string;
      variant?: string;
      bind?: Record<string, { fromRow: string }>;
    }>;
    layout?: Record<string, unknown>;
  }>;
};

export function createFetchTransport(options: { baseUrl?: string; fetch?: typeof fetch; credentials?: RequestCredentials; onWarning?: (code: string) => void; codec?: WireCodec }): WorkcoreTransport {
  const fetcher = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? '/workcore/api').replace(/\/$/, '');
  const codec = options.codec ?? jsonWireCodec;
  if (!codec.id) throw new TypeError('Wire codecs must provide a non-empty id');
  if (codec.id === jsonWireCodec.id && codec !== jsonWireCodec) throw new TypeError("The 'json' codec id is reserved for jsonWireCodec");
  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('x-workcore-codec', codec.id);
    const response = await fetcher(url, { credentials: options.credentials ?? 'same-origin', ...init, headers });
    const data = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) {
      let decoded = data;
      if (codec.id !== 'json' && isCodecEnvelope(data, codec.id)) decoded = codec.decode((data as { payload: JsonValue }).payload);
      const payload = decoded as { error?: { code?: string; message?: string } };
      throw new WorkcoreClientError(payload.error?.code ?? 'HTTP_ERROR', payload.error?.message ?? `Request failed (${response.status})`, response.status);
    }
    if (codec.id === 'json') return data as T;
    if (!isCodecEnvelope(data, codec.id)) throw new WorkcoreClientError('WIRE_CODEC_MISMATCH', `Server response did not use '${codec.id}'`, response.status);
    return codec.decode((data as { payload: JsonValue }).payload) as T;
  }
  const operationBody = (value: unknown) => {
    if (codec.id === 'json') return JSON.stringify(jsonWireCodec.encode(value));
    const payload = jsonWireCodec.encode(codec.encode(value));
    return JSON.stringify({ workcoreCodec: codec.id, payload });
  };
  return {
    request: async ({ path, applicationId, workspaceId, operation, input }) => {
      const response = await json<Record<string, unknown>>(`${baseUrl}/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: operationBody({ applicationId, workspaceId, operation, input }),
      });
      const warnings = Array.isArray(response.deliveryWarnings)
        ? response.deliveryWarnings.filter((warning): warning is string => typeof warning === 'string')
        : typeof response.deliveryWarning === 'string' ? [response.deliveryWarning] : [];
      for (const warning of warnings) options.onWarning?.(warning);
      return ('result' in response ? response.result : response) as never;
    },
    manifest: async (applicationId, workspaceId) => json(`${baseUrl}/manifest?applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}`),
    applications: async () => (await json<{ applications: Array<{ id: string; workspaceCount: number }> }>(`${baseUrl}/applications`)).applications,
    workspaces: async (applicationId) => (await json<{ workspaces: Array<{ id: string; name: string }> }>(`${baseUrl}/workspaces?applicationId=${encodeURIComponent(applicationId)}`)).workspaces,
    subscribe: (applicationId, workspaceId, callbacks) => {
      const source = new EventSource(`${baseUrl}/events?applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}`, { withCredentials: true });
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
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = 'WorkcoreClientError'; }
}

export function createClient<D>(options: { transport: WorkcoreTransport; applicationId: string; workspaceId: string }) {
  const request = <T>(path: 'query' | 'mutate' | 'enqueue', operation: string, input: unknown) => options.transport.request<T>({ path, applicationId: options.applicationId, workspaceId: options.workspaceId, operation, input });
  return {
    query: <N extends QueryNames<D>>(operation: N, input: InputFor<DefinitionAt<D, 'query', N>>) => request<OutputFor<DefinitionAt<D, 'query', N>>>('query', operation, input),
    mutate: <N extends MutationNames<D>>(operation: N, input: InputFor<DefinitionAt<D, 'mutation', N>>) => request<OutputFor<DefinitionAt<D, 'mutation', N>>>('mutate', operation, input),
    enqueue: <N extends TaskNames<D>>(operation: N, input: InputFor<DefinitionAt<D, 'task', N>>) => request<{ runId: string }>('enqueue', operation, input),
    subscribe: <N extends QueryNames<D>>(operation: N, input: InputFor<DefinitionAt<D, 'query', N>>, callbacks: { onData(data: OutputFor<DefinitionAt<D, 'query', N>>): void; onError(error: Error): void }) => {
      let disposed = false;
      let generation = 0;
      let inFlight = false;
      let rerun = false;
      const refresh = async () => {
        if (disposed) return;
        if (inFlight) { rerun = true; return; }
        inFlight = true;
        const ownGeneration = ++generation;
        try {
          const value = await request<OutputFor<DefinitionAt<D, 'query', N>>>('query', operation, input);
          if (!disposed && ownGeneration === generation && !rerun) callbacks.onData(value);
        } catch (error) { if (!disposed && !rerun) callbacks.onError(error instanceof Error ? error : new Error(String(error))); }
        finally { inFlight = false; if (rerun && !disposed) { rerun = false; void refresh(); } }
      };
      // Subscribe first so invalidations during the initial query are not lost.
       const unsubscribe = options.transport.subscribe(options.applicationId, options.workspaceId, { onInvalidate: () => void refresh(), onReady: () => void refresh(), onReconnect: () => void refresh(), onError: callbacks.onError });
       void refresh();
      return () => { disposed = true; unsubscribe(); };
    },
  };
}

function isCodecEnvelope(value: unknown, id: string): value is { workcoreCodec: string; payload: JsonValue } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { workcoreCodec?: unknown }).workcoreCodec === id && 'payload' in value;
}

export type TypedClient<D> = ReturnType<typeof createClient<D>>;
