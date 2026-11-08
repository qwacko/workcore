import { randomUUID } from './uuid.js';
import { sourceKey } from './sources.js';
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
export type LiveSystemOperation =
  | 'health.inspect'
  | 'runs.list'
  | 'runs.inspect'
  | 'runs.trace'
  | 'schedules.list'
  | 'schedules.inspect'
  | 'tables.list'
  | 'tables.read'
  | 'history.list'
  | 'files.list';
type DisplayMap<A extends Definition> = NonNullable<A['displays']>['displays'];
type DisplayInput<D> = D extends { input?: infer I }
  ? I extends z.ZodType
    ? z.input<I>
    : Record<string, never>
  : Record<string, never>;
export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
type Consumer = {
  listener: (state: LiveState<any>) => void;
  waiters: Set<() => void>;
  ended?: LiveState<unknown>;
};
type Entry = {
  kind: 'view' | 'display' | 'manifest' | 'system';
  name: string;
  input: unknown;
  key: string;
  state: LiveState<unknown>;
  consumers: Set<Consumer>;
  id?: string;
  releaseTimer?: ReturnType<typeof setTimeout>;
  cacheTimer?: ReturnType<typeof setTimeout>;
  expiresAt?: number;
};
export type ClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Client/session-local live data only. No persistent storage or cross-client sharing. */
  subscriptions?: { keepAliveMs?: number; cacheTimeMs?: number; maxCached?: number };
};

export function createClient<A extends Definition>(options: ClientOptions) {
  const entries = new Map<string, Entry>();
  const resources = new Map<string, Entry>();
  const inactive = new Map<string, Entry>();
  const queries = new Map<string, Promise<Result<unknown>>>();
  const keepAliveMs = options.subscriptions?.keepAliveMs ?? 1000;
  const cacheTimeMs = options.subscriptions?.cacheTimeMs ?? 30_000;
  const maxCached = options.subscriptions?.maxCached ?? 64;
  for (const value of [keepAliveMs, cacheTimeMs, maxCached]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Subscription cache options must be non-negative safe integers');
  }
  const base = options.baseUrl.replace(/\/$/, '');
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  let socket: WebSocket | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let closed = false;
  const emit = (entry: Entry) => {
    for (const consumer of entry.consumers) {
      for (const waiter of consumer.waiters) waiter();
      try {
        consumer.listener(entry.state);
      } catch (error) {
        console.error('Workcore subscription listener failed', error);
      }
    }
  };
  async function post<T>(path: string, body: unknown): Promise<T> {
    if (closed) throw new ClientError('CLIENT_CLOSED', 'Create a new client after close()');
    const response = await request(`${base}/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: encodeJson(body, 65_536),
    });
    const payload = (await response.json()) as T & { error?: { code: string; message: string } };
    if (!response.ok)
      throw new ClientError(
        payload.error?.code ?? 'HTTP_ERROR',
        payload.error?.message ?? response.statusText,
        response.status,
      );
    return payload;
  }
  function readQuery<T>(name: string, input: unknown): Promise<Result<T>> {
    let key: string;
    try {
      encodeJson(input, 65_536);
      key = sourceKey([name, input]);
    } catch (error) {
      return Promise.reject(error);
    }
    let pending = queries.get(key);
    if (!pending) {
      pending = post<Result<unknown>>('query', { name, input }).finally(() => {
        if (queries.get(key) === pending) queries.delete(key);
      });
      queries.set(key, pending);
    }
    return pending as Promise<Result<T>>;
  }
  async function write<T>(path: string, body: unknown): Promise<T> {
    // Reads started before/during a write must not be reused by later callers.
    queries.clear();
    try {
      return await post<T>(path, body);
    } finally {
      queries.clear();
    }
  }
  async function fileRequest(path: string, init: RequestInit = {}): Promise<Response> {
    if (closed) throw new ClientError('CLIENT_CLOSED', 'Create a new client after close()');
    const response = await request(`${base}/files${path}`, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      throw new ClientError(
        payload.error?.code ?? 'HTTP_ERROR',
        payload.error?.message ?? response.statusText,
        response.status,
      );
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
        connection.send(
          encodeJson(
            { type: 'subscribe', id, kind: entry.kind, name: entry.name, input: entry.input },
            65_536,
          ),
        );
      }
      heartbeat = setInterval(() => {
        if (connection.readyState === WebSocket.OPEN)
          connection.send(JSON.stringify({ type: 'refresh' }));
      }, 30_000);
    });
    connection.addEventListener('message', (event) => {
      if (socket !== connection) return;
      try {
        const payload = JSON.parse(String(event.data)) as {
          type: string;
          id?: string;
          data?: unknown;
          revision?: number;
          error?: { code: string; message: string };
        };
        if (payload.type === 'error' && !payload.id)
          for (const entry of [...inactive.values()]) evict(entry);
        const targets = payload.id
          ? [entries.get(payload.id)].filter((entry): entry is Entry => !!entry)
          : [...entries.values()];
        for (const entry of targets) {
          if (payload.type === 'error') {
            entry.state = {
              status: 'error',
              revision: 0,
              error: payload.error ?? { code: 'PROTOCOL_ERROR', message: 'Subscription failed' },
            };
          } else if (
            typeof payload.revision === 'number' &&
            payload.revision >= entry.state.revision
          ) {
            if (payload.type === 'snapshot')
              entry.state = { status: 'live', data: payload.data, revision: payload.revision };
            else if (payload.type === 'revision' && entry.state.status === 'live')
              entry.state = { ...entry.state, revision: payload.revision };
          }
          emit(entry);
        }
      } catch {
        connection.close(1002, 'Invalid server message');
      }
    });
    connection.addEventListener('error', () => connection.close());
    connection.addEventListener('close', (event) => {
      if (socket !== connection) return;
      socket = undefined;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      if (event.code === 1008) for (const entry of [...inactive.values()]) evict(entry);
      for (const entry of entries.values()) {
        entry.state =
          event.code === 1008
            ? {
                status: 'error',
                revision: 0,
                error: { code: 'ACCESS_EXPIRED', message: 'Access expired or was revoked' },
              }
            : { ...entry.state, status: 'reconnecting' };
        emit(entry);
      }
      if (!closed && entries.size) {
        reconnectTimer = setTimeout(
          () => {
            reconnectTimer = undefined;
            connect();
          },
          Math.min(30_000, 500 * 2 ** Math.min(attempts++, 6)),
        );
      }
    });
  }
  function stopSocket(): void {
    const previous = socket;
    socket = undefined;
    previous?.close();
    if (heartbeat) clearInterval(heartbeat);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    heartbeat = undefined;
    reconnectTimer = undefined;
  }
  function clearTimers(entry: Entry) {
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    if (entry.cacheTimer) clearTimeout(entry.cacheTimer);
    entry.releaseTimer = undefined;
    entry.cacheTimer = undefined;
    entry.expiresAt = undefined;
  }
  function detach(entry: Entry) {
    if (!entry.id) return;
    const id = entry.id;
    entry.id = undefined;
    entries.delete(id);
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: 'unsubscribe', id }));
    if (!entries.size) stopSocket();
  }
  function evict(entry: Entry) {
    clearTimers(entry);
    inactive.delete(entry.key);
    resources.delete(entry.key);
    detach(entry);
    entry.state = { status: 'loading', revision: 0 };
  }
  function release(entry: Entry) {
    if (entry.consumers.size) return;
    clearTimers(entry);
    inactive.delete(entry.key);
    inactive.set(entry.key, entry);
    const stop = () => {
      entry.releaseTimer = undefined;
      detach(entry);
      if (!cacheTimeMs || !maxCached || entry.state.status === 'error') {
        evict(entry);
        return;
      }
      // An inactive snapshot is a preview until a new server snapshot confirms it.
      entry.state = { ...entry.state, status: 'reconnecting', revision: 0 };
      entry.expiresAt = Date.now() + cacheTimeMs;
      entry.cacheTimer = setTimeout(() => evict(entry), cacheTimeMs);
    };
    if (keepAliveMs && maxCached) entry.releaseTimer = setTimeout(stop, keepAliveMs);
    else stop();
    while (inactive.size > maxCached) evict(inactive.values().next().value!);
  }
  function subscribeResource<T>(
    kind: Entry['kind'],
    name: string,
    input: unknown,
    listener: (state: LiveState<T>) => void,
  ): Subscription<T> {
    if (closed) throw new ClientError('CLIENT_CLOSED', 'Create a new client after close()');
    // Capture the wire input: caller mutations cannot change the identity on reconnect.
    const capturedInput = JSON.parse(encodeJson(input, 65_536));
    const key = sourceKey([kind, name, capturedInput]);
    let entry = resources.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      evict(entry);
      entry = undefined;
    }
    if (!entry) {
      entry = {
        kind,
        name,
        input: capturedInput,
        key,
        state: { status: 'loading', revision: 0 },
        consumers: new Set(),
      };
      resources.set(key, entry);
    }
    const active = entry;
    clearTimers(active);
    inactive.delete(key);
    const consumer: Consumer = { listener, waiters: new Set() };
    active.consumers.add(consumer);
    let start = false;
    if (!active.id) {
      active.id = randomUUID();
      entries.set(active.id, active);
      start = true;
    }
    // A second observer gets the current result synchronously, never a loading flash.
    try {
      listener(active.state as LiveState<T>);
    } catch (error) {
      console.error('Workcore subscription listener failed', error);
    }
    if (!closed) {
      if (start && socket?.readyState === WebSocket.OPEN)
        socket.send(
          encodeJson(
            { type: 'subscribe', id: active.id, kind, name, input: capturedInput },
            65_536,
          ),
        );
      else connect();
    }
    const state = () => (consumer.ended ?? active.state) as LiveState<T>;
    return {
      get state() {
        return state();
      },
      unsubscribe() {
        if (consumer.ended) return;
        consumer.ended = {
          status: 'error',
          revision: 0,
          error: { code: 'UNSUBSCRIBED', message: 'Subscription ended' },
        };
        active.consumers.delete(consumer);
        for (const waiter of consumer.waiters) waiter();
        if (!closed && !active.consumers.size) release(active);
      },
      whenRevision(revision, timeoutMs = 10_000) {
        return new Promise<void>((resolve, reject) => {
          const finish = () => {
            clearTimeout(timer);
            consumer.waiters.delete(check);
          };
          const check = () => {
            const current = state();
            if (current.status === 'error') {
              finish();
              reject(new ClientError(current.error!.code, current.error!.message));
            } else if (current.status === 'live' && current.revision >= revision) {
              finish();
              resolve();
            }
          };
          const timer = setTimeout(() => {
            finish();
            reject(
              new ClientError('SYNC_TIMEOUT', 'Subscription did not reach the requested revision'),
            );
          }, timeoutMs);
          consumer.waiters.add(check);
          check();
        });
      },
    };
  }
  return {
    async manifest(): Promise<Manifest> {
      if (closed) throw new ClientError('CLIENT_CLOSED', 'Create a new client after close()');
      const response = await request(`${base}/manifest`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const data = (await response.json()) as { error?: { code: string; message: string } };
      if (!response.ok)
        throw new ClientError(
          data.error?.code ?? 'HTTP_ERROR',
          data.error?.message ?? response.statusText,
          response.status,
        );
      const parsed = manifestSchema.safeParse(data);
      if (!parsed.success)
        throw new ClientError(
          'INVALID_MANIFEST',
          'The server returned an unsupported or invalid manifest',
        );
      return parsed.data;
    },
    display<K extends keyof DisplayMap<A> & string>(
      name: K,
      ...args: DisplayInput<DisplayMap<A>[K]> extends Record<string, never>
        ? [input?: DisplayInput<DisplayMap<A>[K]>]
        : [input: DisplayInput<DisplayMap<A>[K]>]
    ): Promise<ManifestDocument> {
      return post('display', { name, input: (args[0] ?? {}) as Json });
    },
    subscribeDisplay<K extends keyof DisplayMap<A> & string>(
      name: K,
      input: DisplayInput<DisplayMap<A>[K]>,
      listener: (state: LiveState<ManifestDocument>) => void,
    ): Subscription<ManifestDocument> {
      return subscribeResource('display', name, input, listener);
    },
    subscribeManifest(listener: (state: LiveState<Manifest>) => void): Subscription<Manifest> {
      return subscribeResource('manifest', '', {}, listener);
    },
    subscribeSystem(
      name: LiveSystemOperation,
      input: Json,
      listener: (state: LiveState<Json>) => void,
    ): Subscription<Json> {
      return subscribeResource('system', name, input, listener);
    },
    refreshSubscriptions(): void {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'refresh' }));
    },
    query<K extends (keyof A['views'] | keyof A['queries']) & string>(
      name: K,
      input: z.input<(A['views'] & A['queries'])[K]['input']>,
    ): Promise<Result<z.output<(A['views'] & A['queries'])[K]['output']>>> {
      return readQuery(name, input);
    },
    mutate<K extends keyof A['mutations'] & string>(
      name: K,
      input: z.input<A['mutations'][K]['input']>,
      requestId: string = randomUUID(),
    ): Promise<Result<z.output<A['mutations'][K]['output']>>> {
      return write('mutate', { name, input, requestId });
    },
    enqueue<K extends keyof A['jobs'] & string>(
      name: K,
      input: z.input<A['jobs'][K]['input']>,
      requestId: string = randomUUID(),
    ): Promise<Result<string>> {
      return write('enqueue', { name, input, requestId });
    },
    subscribe<K extends keyof A['views'] & string>(
      name: K,
      input: z.input<A['views'][K]['input']>,
      listener: (state: LiveState<z.output<A['views'][K]['output']>>) => void,
    ): Subscription<z.output<A['views'][K]['output']>> {
      return subscribeResource('view', name, input, listener);
    },
    inspect(resource: string, after?: string): Promise<Json> {
      return post('inspect', { resource, ...(after === undefined ? {} : { after }) });
    },
    trace(runId: string, after = 0): Promise<Json> {
      return post('trace', { runId, after });
    },
    control(
      resource: 'run' | 'schedule',
      id: string,
      action: 'retry' | 'cancel' | 'enable' | 'disable',
    ): Promise<{ revision: number; runId?: string }> {
      return write('control', { resource, id, action });
    },
    system(name: keyof Manifest['system'] & string, input: Json = {}): Promise<Json> {
      return write('system', { name, input });
    },
    files: {
      list(after?: string) {
        return fileRequest(after ? `?after=${encodeURIComponent(after)}` : '').then(
          (response) =>
            response.json() as Promise<{
              rows: {
                id: string;
                ownerId: string;
                filename: string;
                contentType: string;
                size: number;
                status: string;
                createdAt: number;
                uploadedAt: number | null;
              }[];
              nextCursor: string | null;
            }>,
        );
      },
      async upload(file: Blob & { name?: string }, options: { signal?: AbortSignal } = {}) {
        const headers = new Headers({
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': file.name || 'file',
        });
        const response = await fileRequest('', {
          method: 'POST',
          headers,
          body: file,
          signal: options.signal,
        });
        return response.json() as Promise<{ id: string; status: 'ready' }>;
      },
      async download(id: string) {
        return (await fileRequest(`/${encodeURIComponent(id)}`)).blob();
      },
      async remove(id: string) {
        await fileRequest(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
    },
    close() {
      if (closed) return;
      closed = true;
      for (const entry of resources.values()) {
        clearTimers(entry);
        entry.state = {
          status: 'error',
          revision: 0,
          error: { code: 'CLIENT_CLOSED', message: 'Client closed' },
        };
        for (const consumer of entry.consumers) consumer.ended = entry.state;
        emit(entry);
        entry.consumers.clear();
      }
      queries.clear();
      inactive.clear();
      resources.clear();
      entries.clear();
      stopSocket();
    },
  };
}

/** Runtime-discovered operations share the same transport, errors and subscription lifecycle. */
export function createRuntimeClient(options: Parameters<typeof createClient>[0]) {
  return createClient<Definition>(options);
}
export type RuntimeClient = ReturnType<typeof createRuntimeClient>;
export { createSources, sourceKey } from './sources.js';
export type { SourceReference } from './sources.js';
export type Sources = ReturnType<typeof import('./sources.js').createSources>;

/** Framework-neutral mutation/job submission state with stable retries per action instance. */
export function createActionDispatcher(client: RuntimeClient) {
  const pending = new Map<string, { key: string; requestId: string }>();
  return {
    async execute(
      scope: string,
      operation: { kind: 'mutation' | 'job'; name: string },
      input: Json,
    ): Promise<Result<Json>> {
      const key = encodeJson([operation, input]);
      let request = pending.get(scope);
      if (!request || request.key !== key) {
        request = { key, requestId: randomUUID() };
        pending.set(scope, request);
      }
      try {
        const result =
          operation.kind === 'mutation'
            ? await client.mutate(operation.name, input, request.requestId)
            : await client.enqueue(operation.name, input, request.requestId);
        pending.delete(scope);
        return result as Result<Json>;
      } catch (error) {
        // Keep the same ID only for an identical retry from this mounted action instance.
        throw error;
      }
    },
    clear(scope: string) {
      pending.delete(scope);
    },
    close() {
      pending.clear();
    },
  };
}
