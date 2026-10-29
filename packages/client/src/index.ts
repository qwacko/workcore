import type { Definition, Json, ManifestDocument } from '@workcore/core';
import { encodeJson, manifestSchema } from '@workcore/core';
import type { Manifest } from '@workcore/core';
import type { z } from 'zod';

export type Result<T> = { data: T; revision: number };
export type LiveState<T> = {
  status: 'loading' | 'live' | 'reconnecting' | 'error';
  data?: T;
  revision: number;
  error?: { code: string; message: string };
};
export type Subscription<T> = {
  readonly state: LiveState<T>;
  unsubscribe(): void;
  whenRevision(revision: number, timeoutMs?: number): Promise<void>;
};
type DisplayMap<A extends Definition> = NonNullable<A['displays']>['displays'];
type DisplayInput<D> = D extends { input?: infer I } ? I extends z.ZodType ? z.input<I> : Record<string, never> : Record<string, never>;
export class ClientError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); }
}
type Entry = {
  kind: 'view' | 'display' | 'manifest';
  name: string;
  input: unknown;
  state: LiveState<unknown>;
  listener: (state: LiveState<any>) => void;
  waiters: Set<() => void>;
};

export function createClient<A extends Definition>(options: { baseUrl: string; fetch?: typeof fetch }) {
  const entries = new Map<string, Entry>();
  const base = options.baseUrl.replace(/\/$/, '');
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  let socket: WebSocket | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let closed = false;
  const emit = (entry: Entry) => {
    for (const waiter of entry.waiters) waiter();
    try { entry.listener(entry.state); } catch (error) { console.error('Workcore subscription listener failed', error); }
  };
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await request(`${base}/${path}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: encodeJson(body, 65_536),
    });
    const payload = await response.json() as T & { error?: { code: string; message: string } };
    if (!response.ok) throw new ClientError(payload.error?.code ?? 'HTTP_ERROR', payload.error?.message ?? response.statusText, response.status);
    return payload;
  }
  async function fileRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await request(`${base}/files${path}`, { ...init, credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
      throw new ClientError(payload.error?.code ?? 'HTTP_ERROR', payload.error?.message ?? response.statusText, response.status);
    }
    return response;
  }
  function connect(): void {
    if (closed || !entries.size || socket || reconnectTimer) return;
    const url = new URL(`${base}/live`, globalThis.location?.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const connection = new WebSocket(url);
    socket = connection;
    connection.addEventListener('open', () => {
      if (socket !== connection) return;
      attempts = 0;
      for (const [id, entry] of entries) {
        entry.state = { ...entry.state, revision: 0 };
         connection.send(encodeJson({ type: 'subscribe', id, kind: entry.kind, name: entry.name, input: entry.input }, 65_536));
      }
      heartbeat = setInterval(() => {
        if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: 'refresh' }));
      }, 30_000);
    });
    connection.addEventListener('message', event => {
      if (socket !== connection) return;
      try {
        const payload = JSON.parse(String(event.data)) as { type: string; id?: string; data?: unknown; revision?: number; error?: { code: string; message: string } };
        const targets = payload.id ? [entries.get(payload.id)].filter((entry): entry is Entry => !!entry) : [...entries.values()];
        for (const entry of targets) {
          if (payload.type === 'error') {
            entry.state = { status: 'error', revision: 0, error: payload.error ?? { code: 'PROTOCOL_ERROR', message: 'Subscription failed' } };
          } else if (typeof payload.revision === 'number' && payload.revision >= entry.state.revision) {
            if (payload.type === 'snapshot') entry.state = { status: 'live', data: payload.data, revision: payload.revision };
            else if (payload.type === 'revision' && entry.state.status === 'live') entry.state = { ...entry.state, revision: payload.revision };
          }
          emit(entry);
        }
      } catch { connection.close(1002, 'Invalid server message'); }
    });
    connection.addEventListener('error', () => connection.close());
    connection.addEventListener('close', event => {
      if (socket !== connection) return;
      socket = undefined;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      for (const entry of entries.values()) {
        entry.state = event.code === 1008
          ? { status: 'error', revision: 0, error: { code: 'ACCESS_EXPIRED', message: 'Access expired or was revoked' } }
          : { ...entry.state, status: 'reconnecting' };
        emit(entry);
      }
      if (!closed && entries.size) {
        reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect(); }, Math.min(30_000, 500 * 2 ** Math.min(attempts++, 6)));
      }
    });
  }
  function stopSocket(): void {
    const previous = socket;
    socket = undefined;
    previous?.close();
    if (heartbeat) clearInterval(heartbeat);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    heartbeat = undefined; reconnectTimer = undefined;
  }
  function subscribeResource<T>(kind: Entry['kind'], name: string, input: unknown, listener: (state: LiveState<T>) => void): Subscription<T> {
    if (closed) throw new ClientError('CLIENT_CLOSED', 'Create a new client after close()');
    encodeJson(input, 65_536);
    const id = crypto.randomUUID();
    const entry: Entry = { kind, name, input, state: { status: 'loading', revision: 0 }, listener: listener as (state: LiveState<any>) => void, waiters: new Set() };
    entries.set(id, entry);
    emit(entry);
    if (socket?.readyState === WebSocket.OPEN) socket.send(encodeJson({ type: 'subscribe', id, kind, name, input }, 65_536));
    else connect();
    return {
      get state() { return entry.state as LiveState<T>; },
      unsubscribe() {
        entries.delete(id);
        entry.state = { status: 'error', revision: 0, error: { code: 'UNSUBSCRIBED', message: 'Subscription ended' } };
        for (const waiter of entry.waiters) waiter();
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'unsubscribe', id }));
        if (!entries.size) stopSocket();
      },
      whenRevision(revision, timeoutMs = 10_000) {
        return new Promise<void>((resolve, reject) => {
          const finish = () => { clearTimeout(timer); entry.waiters.delete(check); };
          const check = () => {
            if (entry.state.status === 'error') { finish(); reject(new ClientError(entry.state.error!.code, entry.state.error!.message)); }
            else if (entry.state.status === 'live' && entry.state.revision >= revision) { finish(); resolve(); }
          };
          const timer = setTimeout(() => { finish(); reject(new ClientError('SYNC_TIMEOUT', 'Subscription did not reach the requested revision')); }, timeoutMs);
          entry.waiters.add(check); check();
        });
      },
    };
  }
  return {
    async manifest(): Promise<Manifest> {
      const response = await request(`${base}/manifest`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json() as { error?: { code: string; message: string } };
      if (!response.ok) throw new ClientError(data.error?.code ?? 'HTTP_ERROR', data.error?.message ?? response.statusText, response.status);
      const parsed = manifestSchema.safeParse(data);
      if (!parsed.success) throw new ClientError('INVALID_MANIFEST', 'The server returned an unsupported or invalid manifest');
      return parsed.data;
    },
    display<K extends keyof DisplayMap<A> & string>(name: K, ...args: DisplayInput<DisplayMap<A>[K]> extends Record<string, never>
      ? [input?: DisplayInput<DisplayMap<A>[K]>]
      : [input: DisplayInput<DisplayMap<A>[K]>]): Promise<ManifestDocument> {
      return post('display', { name, input: (args[0] ?? {}) as Json });
    },
    subscribeDisplay<K extends keyof DisplayMap<A> & string>(name: K, input: DisplayInput<DisplayMap<A>[K]>, listener: (state: LiveState<ManifestDocument>) => void): Subscription<ManifestDocument> {
      return subscribeResource('display', name, input, listener);
    },
    subscribeManifest(listener: (state: LiveState<Manifest>) => void): Subscription<Manifest> {
      return subscribeResource('manifest', '', {}, listener);
    },
    query<K extends (keyof A['views'] | keyof A['queries']) & string>(name: K, input: z.input<(A['views'] & A['queries'])[K]['input']>): Promise<Result<z.output<(A['views'] & A['queries'])[K]['output']>>> {
      return post('query', { name, input });
    },
    mutate<K extends keyof A['mutations'] & string>(name: K, input: z.input<A['mutations'][K]['input']>, requestId: string = crypto.randomUUID()): Promise<Result<z.output<A['mutations'][K]['output']>>> {
      return post('mutate', { name, input, requestId });
    },
    enqueue<K extends keyof A['jobs'] & string>(name: K, input: z.input<A['jobs'][K]['input']>, requestId: string = crypto.randomUUID()): Promise<Result<string>> {
      return post('enqueue', { name, input, requestId });
    },
    subscribe<K extends keyof A['views'] & string>(name: K, input: z.input<A['views'][K]['input']>, listener: (state: LiveState<z.output<A['views'][K]['output']>>) => void): Subscription<z.output<A['views'][K]['output']>> {
      return subscribeResource('view', name, input, listener);
    },
    inspect(resource: string, after?: string): Promise<Json> { return post('inspect', { resource, ...(after === undefined ? {} : { after }) }); },
    trace(runId: string, after = 0): Promise<Json> { return post('trace', { runId, after }); },
    control(resource: 'run' | 'schedule', id: string, action: 'retry' | 'cancel' | 'enable' | 'disable'): Promise<{ revision: number }> { return post('control', { resource, id, action }); },
    system(name: keyof Manifest['system'] & string, input: Json = {}): Promise<Json> { return post('system', { name, input }); },
    files: {
      list(after?: string) { return fileRequest(after ? `?after=${encodeURIComponent(after)}` : '').then(response => response.json() as Promise<{ rows: { id: string; ownerId: string; filename: string; contentType: string; size: number; status: string; createdAt: number; uploadedAt: number | null }[]; nextCursor: string | null }>); },
      async upload(file: Blob & { name?: string }, options: { signal?: AbortSignal } = {}) {
        const headers = new Headers({ 'content-type': file.type || 'application/octet-stream', 'x-file-name': file.name || 'file' });
        const response = await fileRequest('', { method: 'POST', headers, body: file, signal: options.signal });
        return response.json() as Promise<{ id: string; status: 'ready' }>;
      },
      async download(id: string) { return (await fileRequest(`/${encodeURIComponent(id)}`)).blob(); },
      async remove(id: string) { await fileRequest(`/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    },
    close() {
      closed = true;
      for (const entry of entries.values()) {
        entry.state = { status: 'error', revision: 0, error: { code: 'CLIENT_CLOSED', message: 'Client closed' } };
        emit(entry);
      }
      entries.clear(); stopSocket();
    },
  };
}

/** Runtime-discovered operations share the same transport, errors and subscription lifecycle. */
export function createRuntimeClient(options: Parameters<typeof createClient>[0]) { return createClient<Definition>(options); }
export type RuntimeClient = ReturnType<typeof createRuntimeClient>;
export { createSources, sourceKey } from './sources.js';
export type { SourceReference } from './sources.js';
export type Sources = ReturnType<typeof import('./sources.js').createSources>;

/** Framework-neutral mutation/job submission state with stable retries per action instance. */
export function createActionDispatcher(client: RuntimeClient) {
  const pending = new Map<string, { key: string; requestId: string }>();
  return {
    async execute(scope: string, operation: { kind: 'mutation' | 'job'; name: string }, input: Json): Promise<Result<Json>> {
      const key = encodeJson([operation, input]);
      let request = pending.get(scope);
      if (!request || request.key !== key) { request = { key, requestId: crypto.randomUUID() }; pending.set(scope, request); }
      try {
        const result = operation.kind === 'mutation'
          ? await client.mutate(operation.name, input, request.requestId)
          : await client.enqueue(operation.name, input, request.requestId);
        pending.delete(scope);
        return result as Result<Json>;
      } catch (error) {
        // Keep the same ID only for an identical retry from this mounted action instance.
        throw error;
      }
    },
    clear(scope: string) { pending.delete(scope); },
    close() { pending.clear(); },
  };
}
