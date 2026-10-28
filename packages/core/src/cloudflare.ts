import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import type { Actor, Definition } from './definitions.js';
import { Engine } from './engine.js';
import { encode, WorkcoreError } from './json.js';
import { shouldRefreshView } from './triggers.js';

export type Session = { actor: Actor; expiresAt: number };
type Subscription = { id: string; name: string; input: unknown };
type Attachment = { session: Session; subscriptions: Subscription[] };
const MAX_MESSAGE_BYTES = 65_536;

function errorData(error: unknown): { code: string; message: string } {
  if (error instanceof WorkcoreError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { code: 'VALIDATION_FAILED', message: 'Input or output did not match its schema' };
  console.error('Workcore request failed', error);
  return { code: 'INTERNAL_ERROR', message: 'Request failed' };
}
function errorResponse(error: unknown): Response {
  return Response.json({ error: errorData(error) }, { status: error instanceof WorkcoreError ? error.status : error instanceof z.ZodError ? 400 : 500, headers: { 'cache-control': 'no-store' } });
}
const message = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), id: z.string().min(1).max(100), name: z.string().min(1).max(64), input: z.unknown() }),
  z.object({ type: z.literal('unsubscribe'), id: z.string() }),
  z.object({ type: z.literal('refresh') }),
]);
const call = z.object({ name: z.string().min(1).max(64), input: z.unknown(), requestId: z.string().min(1).max(200).optional() });

async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new WorkcoreError('CONTENT_TYPE', 'Use application/json', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new WorkcoreError('INVALID_BODY', 'Expected a JSON body');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_MESSAGE_BYTES) { await reader.cancel(); throw new WorkcoreError('TOO_LARGE', 'Request body is too large', 413); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new WorkcoreError('INVALID_BODY', 'Expected valid JSON'); }
}

/** Extend this class and supply one application definition. No adapters or separate worker process. */
export class Workspace<E = unknown> extends DurableObject<E> {
  readonly engine: Engine;
  private executing = false;
  constructor(ctx: DurableObjectState, env: E, definition: Definition<any>) {
    super(ctx, env);
    this.engine = new Engine(ctx.storage, definition, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.engine.onCommit = commit => {
      for (const socket of ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as Attachment | null;
        if (!attachment) { socket.close(1008, 'Missing session'); continue; }
        // Authorization is rechecked even when a view's declared dependencies did not change.
        this.refresh(socket, attachment, commit.changed);
      }
    };
  }
  private valid(session: Session): void {
    if (!session.actor.id || session.expiresAt <= Date.now()) throw new WorkcoreError('UNAUTHENTICATED', 'Session expired', 401);
  }
  private refresh(socket: WebSocket, attachment: Attachment, changed?: Set<string>): void {
    try { this.valid(attachment.session); } catch { socket.close(1008, 'Session expired'); return; }
    const retained: Subscription[] = [];
    for (const subscription of attachment.subscriptions) {
      try {
        if (!this.engine.can(attachment.session.actor, `view:${subscription.name}`)) throw new WorkcoreError('FORBIDDEN', 'Access denied', 403);
        const view = this.engine.definition.views[subscription.name];
        if (!changed || shouldRefreshView(view?.dependsOn, changed)) {
          const result = this.engine.query(attachment.session.actor, subscription.name, subscription.input, true);
          socket.send(encode({ type: 'snapshot', id: subscription.id, ...result }, 600_000));
        } else {
          // Acknowledge revisions that do not affect this view as well.
          socket.send(encode({ type: 'revision', id: subscription.id, revision: this.engine.revision }));
        }
        retained.push(subscription);
      } catch (error) {
        socket.send(encode({ type: 'error', id: subscription.id, error: errorData(error) }));
      }
    }
    attachment.subscriptions = retained;
    socket.serializeAttachment(attachment);
  }
  private async arm(): Promise<void> {
    // Arm BEFORE writes: a committed enqueue cannot be stranded by failure to set a later alarm.
    const current = await this.ctx.storage.getAlarm();
    const next = Date.now() + 1000;
    if (current === null || current > next) await this.ctx.storage.setAlarm(next);
  }
  private async rearm(): Promise<void> {
    const deadlines = this.ctx.getWebSockets().map(socket => (socket.deserializeAttachment() as Attachment | null)?.session.expiresAt).filter((value): value is number => typeof value === 'number');
    const due = this.engine.nextDue();
    if (due !== null) deadlines.push(due);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const session = z.object({ actor: z.object({ id: z.string().min(1).max(200) }), expiresAt: z.number().finite() }).parse(JSON.parse(decodeURIComponent(request.headers.get('x-workcore-session') ?? '')));
      this.valid(session);
      const path = new URL(request.url).pathname;
      const fileRoute = /^\/files(?:\/([a-f0-9-]{36}))?$/.exec(path);
      if (fileRoute) return await this.fileRequest(request, session, fileRoute[1]);
      if (path === '/live' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        // A workspace action must be permitted before opening a connection.
        if (!this.engine.can(session.actor, '$connect')) throw new WorkcoreError('FORBIDDEN', 'Access denied', 403);
        await this.arm();
        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ session, subscriptions: [] } satisfies Attachment);
        await this.rearm();
        return new Response(null, { status: 101, webSocket: client });
      }
      if (path === '/manifest' && request.method === 'GET') return Response.json(this.engine.manifest(session.actor), { headers: { 'cache-control': 'no-store' } });
      if (request.method !== 'POST') throw new WorkcoreError('METHOD_NOT_ALLOWED', 'Use POST', 405);
      const body = await readBody(request);
      let result: unknown;
      if (path === '/query') {
        const input = call.parse(body);
        result = this.engine.query(session.actor, input.name, input.input);
      } else if (path === '/mutate' || path === '/enqueue') {
        const input = call.parse(body);
        if (!input.requestId) throw new WorkcoreError('INVALID_REQUEST_ID', 'requestId is required');
        await this.arm();
        result = path === '/mutate' ? this.engine.mutate(session.actor, input.name, input.input, input.requestId) : this.engine.enqueue(session.actor, input.name, input.input, input.requestId);
      } else if (path === '/inspect') {
        const input = z.object({ resource: z.string(), after: z.string().optional() }).parse(body);
        result = this.engine.inspect(session.actor, input.resource, input.after);
      } else if (path === '/trace') {
        const input = z.object({ runId: z.string(), after: z.number().int().min(0).default(0) }).parse(body);
        result = this.engine.trace(session.actor, input.runId, input.after);
      } else if (path === '/control') {
        const input = z.object({ resource: z.enum(['run', 'schedule']), id: z.string(), action: z.string() }).parse(body);
        await this.arm();
        this.engine.control(session.actor, input.resource, input.id, input.action);
        result = { revision: this.engine.revision };
      } else throw new WorkcoreError('NOT_FOUND', 'Unknown endpoint', 404);
      return Response.json(result, { headers: { 'cache-control': 'no-store' } });
    } catch (error) { return errorResponse(error); }
  }
  private async fileRequest(request: Request, session: Session, id?: string): Promise<Response> {
    const files = this.engine.definition.files;
    if (!files) throw new WorkcoreError('FILES_DISABLED', 'File storage is not configured', 404);
    const bucket = files.bucket(this.env);
    if (request.method === 'POST' && !id) {
      if (!request.body) throw new WorkcoreError('INVALID_BODY', 'Expected a file body');
      const size = Number(request.headers.get('content-length'));
      if (!Number.isSafeInteger(size) || size < 0 || size > files.maxSize) throw new WorkcoreError('FILE_TOO_LARGE', 'A valid Content-Length within the file size limit is required', 413);
      await this.arm();
      const created = this.engine.createFile(session.actor, {
        filename: request.headers.get('x-file-name') ?? 'file',
        contentType: request.headers.get('content-type') ?? 'application/octet-stream',
        size,
      });
      try {
        await bucket.put(`workcore/files/${created.id}`, request.body, {
          httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' },
        });
        const object = await bucket.head(`workcore/files/${created.id}`);
        if (!object || object.size !== size || object.size > files.maxSize) throw new WorkcoreError('UPLOAD_VERIFY_FAILED', 'Stored file size did not match the upload or configured limit', 502);
        this.engine.finishFileUpload(session.actor, created.id, size);
        return Response.json({ id: created.id, status: 'ready' }, { status: 201, headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        throw error;
      }
    }
    if (request.method === 'GET' && !id) {
      const cursor = new URL(request.url).searchParams.get('after') ?? '';
      return Response.json(this.engine.listFiles(session.actor, cursor), { headers: { 'cache-control': 'no-store' } });
    }
    if (!id) throw new WorkcoreError('METHOD_NOT_ALLOWED', 'Use GET or POST for the file collection', 405);
    if (request.method === 'GET') {
      const row = this.engine.getFile(session.actor, id);
      const object = await bucket.get(`workcore/files/${id}`);
      if (!object) throw new WorkcoreError('FILE_NOT_FOUND', 'Stored file is unavailable', 404);
      const headers = new Headers({
        'content-type': String(row.contentType),
        'content-length': String(object.size),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(String(row.filename))}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      });
      return new Response(object.body, { headers });
    }
    if (request.method === 'DELETE') {
      await this.arm();
      this.engine.beginFileDelete(session.actor, id);
      try {
        await bucket.delete(`workcore/files/${id}`);
        this.engine.finishFileDelete(session.actor, id);
        return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        throw error;
      }
    }
    throw new WorkcoreError('METHOD_NOT_ALLOWED', 'Use GET or DELETE for a file', 405);
  }
  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): void {
    try {
      const attachment = socket.deserializeAttachment() as Attachment;
      this.valid(attachment.session);
      if (!this.engine.can(attachment.session.actor, '$connect')) throw new WorkcoreError('FORBIDDEN', 'Access denied', 403);
      if (typeof data !== 'string' || new TextEncoder().encode(data).length > MAX_MESSAGE_BYTES) throw new WorkcoreError('TOO_LARGE', 'Invalid WebSocket message');
      const input = message.parse(JSON.parse(data));
      if (input.type === 'subscribe') {
        // One bounded input per attachment, at most 20 subscriptions and 8KiB of hibernated metadata.
        const subscriptions = attachment.subscriptions.filter(item => item.id !== input.id);
        subscriptions.push({ id: input.id, name: input.name, input: input.input });
        if (subscriptions.length > 20) throw new WorkcoreError('SUBSCRIPTION_LIMIT', 'At most 20 subscriptions per connection');
        const next = { ...attachment, subscriptions };
        encode(next, 8000);
        this.refresh(socket, next);
      } else if (input.type === 'unsubscribe') {
        attachment.subscriptions = attachment.subscriptions.filter(item => item.id !== input.id);
        socket.serializeAttachment(attachment);
      } else this.refresh(socket, attachment);
    } catch (error) {
      socket.send(encode({ type: 'error', error: errorData(error) }));
      if (error instanceof WorkcoreError && [401, 403].includes(error.status)) socket.close(1008, 'Access denied');
    }
  }
  webSocketClose(socket: WebSocket, code: number): void { socket.close([1005, 1006, 1015].includes(code) ? 1000 : code, 'Closed'); }
  webSocketError(socket: WebSocket): void { socket.close(1011, 'Connection failed'); }
  async alarm(): Promise<void> {
    if (this.executing) return;
    this.executing = true;
    try {
      // Durable watchdog remains if execution is interrupted before rearm.
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      await this.cleanupFiles();
      for (const socket of this.ctx.getWebSockets()) this.refresh(socket, socket.deserializeAttachment() as Attachment);
      this.engine.dispatchSchedules();
      await this.engine.executeNext();
      await this.rearm();
    } finally { this.executing = false; }
  }
  private async cleanupFiles(): Promise<void> {
    const files = this.engine.definition.files;
    if (!files) return;
    const bucket = files.bucket(this.env);
    for (const candidate of this.engine.fileCleanupCandidates()) {
      try {
        await bucket.delete(`workcore/files/${candidate.id}`);
        this.engine.completeFileCleanup(candidate.id);
      } catch (error) { console.error('File cleanup will retry', candidate.id, error); }
    }
  }
}

/** Authenticate in the public Worker; never trust actor/session headers supplied by the browser. */
export async function routeWorkspace(request: Request, options: {
  namespace: DurableObjectNamespace;
  authenticate: (request: Request) => Promise<Session | null> | Session | null;
  prefix?: string;
}): Promise<Response> {
  try {
    const url = new URL(request.url);
    const prefix = options.prefix ?? '/api/workspaces/';
    if (!url.pathname.startsWith(prefix)) throw new WorkcoreError('NOT_FOUND', 'Unknown route', 404);
    const parts = url.pathname.slice(prefix.length).split('/');
    const [workspaceId, endpoint, ...tail] = parts;
    if (!workspaceId || !/^[a-zA-Z0-9_-]{1,100}$/.test(workspaceId) || !endpoint || tail.length > 1 || endpoint !== 'files' && tail.length) throw new WorkcoreError('NOT_FOUND', 'Unknown route', 404);
    if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) throw new WorkcoreError('ORIGIN_DENIED', 'Same-origin requests only', 403);
    const session = await options.authenticate(request);
    if (!session || !session.actor.id || session.expiresAt <= Date.now()) throw new WorkcoreError('UNAUTHENTICATED', 'Sign in first', 401);
    const headers = new Headers(request.headers);
    // Only an identity and expiry cross this trusted boundary, never a permission snapshot.
    headers.set('x-workcore-session', encodeURIComponent(encode({ actor: { id: session.actor.id }, expiresAt: Math.min(session.expiresAt, Date.now() + 3_600_000) })));
    const target = new URL(request.url);
    target.pathname = `/${endpoint}${tail.length ? `/${tail[0]}` : ''}`;
    const forwarded = new Request(target, { method: request.method, headers, body: request.body, redirect: 'manual' });
    return await options.namespace.get(options.namespace.idFromName(workspaceId)).fetch(forwarded);
  } catch (error) { return errorResponse(error); }
}
