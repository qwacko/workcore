import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchTransport, validateSemanticInterface, type WorkcoreManifest } from './index.js';
import type { JsonValue, WireCodec } from '@workcore/core';

describe('fetch transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['not json', '{}', 'null', '[]', '{"result":1}'])('rejects malformed successful operation responses: %s', async (body) => {
    const transport = createFetchTransport({ fetch: async () => new Response(body, { headers: { 'x-correlation-id': 'bad-response' } }) });
    await expect(transport.request({ path: 'query', applicationId: 'demo', workspaceId: 'one', operation: 'read', input: {} })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it('retains detailed metadata and structured validation errors', async () => {
    const onWarning = vi.fn();
    const request = { path: 'mutate' as const, applicationId: 'demo', workspaceId: 'one', operation: 'save', input: {} };
    const transport = createFetchTransport({ onWarning, fetch: async () => Response.json({ result: 42, executionId: 'exec-1', correlationId: 'corr-1', deliveryWarnings: ['EVENT_DELIVERY_FAILED'] }) });
    expect(await transport.requestDetailed!(request)).toEqual({ result: 42, executionId: 'exec-1', correlationId: 'corr-1', deliveryWarnings: ['EVENT_DELIVERY_FAILED'] });
    expect(onWarning).toHaveBeenCalledWith('EVENT_DELIVERY_FAILED');
    const forbidden = createFetchTransport({ fetch: async () => Response.json({ error: { code: 'VALIDATION_FAILED', message: 'Required', correlationId: 'corr-2', issues: [{ path: ['name'], message: 'Required' }] } }, { status: 400 }) });
    await expect(forbidden.request(request)).rejects.toMatchObject({ correlationId: 'corr-2', issues: [{ path: ['name'], message: 'Required' }] });
  });

  it('rejects malformed enqueue responses and accepts a queued run envelope', async () => {
    const request = { path: 'enqueue' as const, applicationId: 'demo', workspaceId: 'one', operation: 'save', input: {} };
    await expect(createFetchTransport({ fetch: async () => Response.json({}, { status: 202, headers: { 'x-correlation-id': 'queued-error' } }) }).request(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 202, correlationId: 'queued-error' });
    expect(await createFetchTransport({ fetch: async () => Response.json({ runId: 'run-1' }, { status: 202 }) }).request(request)).toEqual({ runId: 'run-1' });
  });

  it('preserves codec error fallbacks and wraps decoder failures with correlation context', async () => {
    const codec: WireCodec = { id: 'broken-v1', encode: () => null, decode: () => { throw new Error('private decoder details'); } };
    const request = { path: 'query' as const, applicationId: 'demo', workspaceId: 'one', operation: 'read', input: {} };
    const broken = createFetchTransport({ codec, fetch: async () => Response.json({ workcoreCodec: codec.id, payload: null }, { headers: { 'x-correlation-id': 'decode-1' } }) });
    await expect(broken.request(request)).rejects.toMatchObject({ code: 'WIRE_DECODING_FAILED', correlationId: 'decode-1', status: 200 });
    const unsupported = createFetchTransport({ codec, fetch: async () => Response.json({ error: { code: 'WIRE_CODEC_UNSUPPORTED', message: 'Unsupported', correlationId: 'codec-1' } }, { status: 406 }) });
    await expect(unsupported.request(request)).rejects.toMatchObject({ code: 'WIRE_CODEC_UNSUPPORTED', correlationId: 'codec-1', status: 406 });
  });

  it('supports injected SSE and header providers without assuming custom fetch config applies to SSE', async () => {
    const source = { onopen: null, onmessage: null, onerror: null, close: vi.fn() };
    const eventSource = vi.fn(() => source);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer example');
      return Response.json({ applications: [] });
    });
    const transport = createFetchTransport({ credentials: 'include', headers: async () => ({ authorization: 'Bearer example' }), fetch: fetcher, eventSource });
    await transport.applications();
    const stop = transport.subscribe('app', 'one', { onInvalidate() {}, onError() {} });
    expect(eventSource).toHaveBeenCalledWith(expect.stringContaining('/events?'), { withCredentials: true });
    stop();
    expect(source.close).toHaveBeenCalled();
    expect(() => createFetchTransport({ credentials: 'omit' }).subscribe('app', 'one', { onInvalidate() {}, onError() {} })).toThrow('Native EventSource');
  });

  it('validates semantic UI versions, features, references and safe field names', () => {
    const manifest = {
      protocolVersion: 2, applicationId: 'demo', operations: [
        { name: 'rows', kind: 'query', input: { type: 'object', properties: { status: { type: 'string', enum: ['planned', 'complete'] } } }, output: {} },
        { name: 'edit', kind: 'mutation', input: {}, output: {} },
      ],
      interface: { version: 1, requiredFeatures: ['collection-editor-v1', 'operation-views-v1'], operationViews: [{ operation: 'rows', kind: 'query', default: 'cards', variants: { cards: { title: 'Rows', renderer: 'table', rowKey: 'id', collection: { itemKey: 'id', paginationMode: 'offset', columns: [{ field: 'title', filter: { type: 'text', targetParam: 'search' } }], editor: { mutation: 'edit' } } } } }, { operation: 'edit', kind: 'mutation', default: 'form', variants: { form: { title: 'Edit', renderer: 'form' } } }], pages: [{ id: 'home', title: 'Home', state: { status: { type: 'select', label: 'Status', default: '', options: [{ value: '', label: 'All' }, { value: 'planned', label: 'Planned' }, { value: 'complete', label: 'Complete' }] } }, blocks: [{ id: 'rows', type: 'query', operation: 'rows', variant: 'cards', inputBindings: { status: { state: 'status' } } }] }] },
    } as WorkcoreManifest;
    expect(validateSemanticInterface(manifest)?.operationViews?.[0]?.default).toBe('cards');
    expect(validateSemanticInterface(manifest)?.operationViews?.[0]?.variants.cards?.collection?.paginationMode).toBe('offset');
    const invalidSelect = structuredClone(manifest);
    invalidSelect.interface!.pages[0]!.state!.status = { type: 'select', label: 'Status', default: 'archived', options: [{ value: 'archived', label: 'Archived' }] };
    expect(() => validateSemanticInterface(invalidSelect)).toThrow(/select state 'status' is incompatible with query input 'status'/);
    expect(() => validateSemanticInterface({ ...manifest, interface: { ...manifest.interface!, pages: [{ id: 'home', title: 'Home', blocks: [{ id: 'rows', type: 'query', operation: 'rows', variant: 'missing' }] }] } })).toThrow(/unavailable query variant/);
    expect(() => validateSemanticInterface({ ...manifest, interface: { ...manifest.interface!, requiredFeatures: ['unknown'] } })).toThrow(/Unsupported required semantic UI feature/);
    const unsafe = structuredClone(manifest);
    unsafe.interface!.operationViews[0]!.variants.cards.collection!.itemKey = '__proto__';
    expect(() => validateSemanticInterface(unsafe)).toThrow(/invalid collection/);
  });

  it('requires paired operation catalog and executor blocks with the declared feature', () => {
    const manifest = {
      protocolVersion: 2, applicationId: 'demo', operations: [],
      interface: { version: 1, requiredFeatures: ['operation-catalog-v1'], operationViews: [], pages: [{ id: 'operations', title: 'Operations', blocks: [
        { id: 'catalog', type: 'operation-catalog', selection: 'main' },
        { id: 'executor', type: 'operation-executor', selection: 'main' },
      ] }] },
    } as WorkcoreManifest;
    expect(validateSemanticInterface(manifest)?.pages[0]?.blocks).toHaveLength(2);
    const { interface: document } = manifest;
    expect(() => validateSemanticInterface({ ...manifest, interface: { ...document!, pages: [{ ...document!.pages[0]!, blocks: [document!.pages[0]!.blocks[0]!] }] } })).toThrow(/requires one catalog and one executor/);
  });

  it('accepts validated chart operation presentations', () => {
    const manifest = {
      protocolVersion: 2,
      applicationId: 'charts',
      operations: [{
        name: 'metrics', kind: 'query', input: { type: 'object', properties: {} },
        output: {
          type: 'object', properties: {
            rows: { type: 'array', items: { type: 'object', properties: { day: { type: 'string' }, count: { type: 'integer' } } } },
          },
        },
      }],
      interface: { version: 1, requiredFeatures: ['operation-views-v1'], operationViews: [{ operation: 'metrics', kind: 'query', default: 'trend', variants: { trend: { title: 'Trend', renderer: 'chart', chart: { xField: 'day', yField: 'count' } } } }], pages: [] },
    } as WorkcoreManifest;
    expect(validateSemanticInterface(manifest).operationViews[0]?.variants.trend?.renderer).toBe('chart');
    const invalid = structuredClone(manifest);
    delete invalid.interface!.operationViews[0]!.variants.trend!.chart;
    expect(() => validateSemanticInterface(invalid)).toThrow(/chart presentation .* is malformed/);
  });

  it('validates versioned custom component descriptors and their required feature', () => {
    const manifest = {
      protocolVersion: 2, applicationId: 'demo', operations: [],
      interface: { version: 1, requiredFeatures: ['custom-placeholder-v1'], operationViews: [], defaultPage: 'home', pages: [{ id: 'home', title: 'Home', blocks: [
        { id: 'chart', type: 'custom', component: 'demo/activity-chart', version: 1, props: { metric: 'count' } },
      ] }] },
    } as WorkcoreManifest;
    expect(validateSemanticInterface(manifest)?.pages[0]?.blocks[0]).toMatchObject({ type: 'custom', component: 'demo/activity-chart' });
    expect(() => validateSemanticInterface({ ...manifest, interface: { ...manifest.interface!, requiredFeatures: [] } })).toThrow(/custom-placeholder-v1/);
    expect(() => validateSemanticInterface({ ...manifest, interface: { ...manifest.interface!, defaultPage: 'missing' } })).toThrow(/Semantic defaultPage/);
    const invalid = structuredClone(manifest);
    const custom = invalid.interface!.pages[0]!.blocks[0]!;
    if (custom.type !== 'custom') throw new Error('Expected custom component descriptor');
    custom.component = '../remote';
    expect(() => validateSemanticInterface(invalid)).toThrow(/invalid custom component descriptor/);
  });

  it('uses JSON operation endpoints and unwraps validated results', async () => {
    let received: RequestInit | undefined;
    const transport = createFetchTransport({
      baseUrl: '/custom/api/',
      fetch: async (_input, init) => {
        received = init;
        return Response.json({ result: { rows: [{ id: 'a' }], nextCursor: null }, executionId: 'exec-1' });
      },
    });
    const result = await transport.request<{ rows: Array<{ id: string }>; nextCursor: string | null }>({
      path: 'query', applicationId: 'demo', workspaceId: 'one', operation: 'items', input: { limit: 10 },
    });
    expect(result.rows[0]?.id).toBe('a');
    expect(JSON.parse(String(received?.body))).toEqual({ applicationId: 'demo', workspaceId: 'one', operation: 'items', input: { limit: 10 } });
  });

  it('exposes only typed platform-resource endpoints and preserves structured errors', async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];
    const transport = createFetchTransport({ baseUrl: '/resource-api', fetch: async (input, init) => {
      const url = new URL(String(input), 'http://workcore.test');
      calls.push({ path: `${url.pathname}${url.search}`, method: init?.method ?? 'GET', ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }) });
      if (url.pathname === '/resource-api/tasks') return Response.json({ runs: [] });
      if (url.pathname === '/resource-api/history') return Response.json({ entries: [] });
      if (url.pathname === '/resource-api/schedules' && init?.method === 'POST') return Response.json({ schedule: { id: 's1' } });
      if (url.pathname.startsWith('/resource-api/schedules/') && init?.method === 'PATCH') return Response.json({ schedule: { id: 's1' } });
      if (url.pathname.startsWith('/resource-api/schedules/') && init?.method === 'DELETE') return Response.json({ ok: true });
      return Response.json({ schedules: [] });
    } });
    const resources = transport.resources!;
    await resources.taskRuns('demo app', 'workspace/one', 25);
    await resources.history('demo app', 'workspace/one');
    await resources.createSchedule('demo app', 'workspace/one', { operation: 'rebuild', input: { id: 'a1' }, kind: 'recurring', cron: '0 9 * * *', timezone: 'UTC' });
    await resources.updateSchedule('demo app', 'workspace/one', 'id/with space', { enabled: false });
    await resources.deleteSchedule('demo app', 'workspace/one', 'id/with space');
    expect(calls.map(({ path, method }) => [path, method])).toEqual([
      ['/resource-api/tasks?applicationId=demo+app&workspaceId=workspace%2Fone&limit=25', 'GET'],
      ['/resource-api/history?applicationId=demo+app&workspaceId=workspace%2Fone&limit=50', 'GET'],
      ['/resource-api/schedules', 'POST'],
      ['/resource-api/schedules/id%2Fwith%20space?applicationId=demo+app&workspaceId=workspace%2Fone', 'PATCH'],
      ['/resource-api/schedules/id%2Fwith%20space?applicationId=demo+app&workspaceId=workspace%2Fone', 'DELETE'],
    ]);
    expect(calls[2]?.body).toMatchObject({ operation: 'rebuild', input: { id: 'a1' }, kind: 'recurring' });

    const forbidden = createFetchTransport({ fetch: async () => Response.json({ error: { code: 'FORBIDDEN', message: 'Schedule management denied' } }, { status: 403 }) });
    await expect(forbidden.resources!.deleteSchedule('demo', 'workspace', 's1')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('surfaces structured API errors', async () => {
    const transport = createFetchTransport({ fetch: async () => Response.json({ error: { code: 'FORBIDDEN', message: 'Access denied' } }, { status: 403 }) });
    await expect(transport.request({ path: 'query', applicationId: 'demo', workspaceId: 'one', operation: 'items', input: {} }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, message: 'Access denied' });
  });

  it('uses a per-transport wire codec for operation inputs and responses', async () => {
    const codec: WireCodec = {
      id: 'test-envelope-v1',
      encode(value) {
        const prepare = (item: unknown): unknown => item instanceof Date ? { __workcoreDate: item.toISOString() }
          : Array.isArray(item) ? item.map(prepare)
            : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, prepare(child)])) : item;
        return { serialized: JSON.stringify(prepare(value)) };
      },
      decode(value) {
        const serialized = (value as { serialized: string }).serialized;
        const revive = (item: unknown): unknown => item && typeof item === 'object' && !Array.isArray(item) && typeof (item as { __workcoreDate?: unknown }).__workcoreDate === 'string'
          ? new Date((item as { __workcoreDate: string }).__workcoreDate)
          : Array.isArray(item) ? item.map(revive)
            : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, revive(child)])) : item;
        return revive(JSON.parse(serialized));
      },
    };
    let received: RequestInit | undefined;
    const returnedDate = new Date('2026-10-12T08:00:00.000Z');
    const transport = createFetchTransport({ codec, fetch: async (_input, init) => {
      received = init;
      return Response.json({ workcoreCodec: codec.id, payload: codec.encode({ result: returnedDate, executionId: 'exec-date' }) });
    } });
    const sentDate = new Date('2026-10-11T08:00:00.000Z');
    const result = await transport.request<Date>({ path: 'query', applicationId: 'demo', workspaceId: 'one', operation: 'date', input: { at: sentDate } });
    const sentEnvelope = JSON.parse(String(received?.body)) as { workcoreCodec: string; payload: JsonValue };
    expect(received?.headers).toBeDefined();
    expect(new Headers(received?.headers).get('x-workcore-codec')).toBe(codec.id);
    expect(codec.decode(sentEnvelope.payload)).toMatchObject({ input: { at: sentDate } });
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(returnedDate.toISOString());
  });

  it('distinguishes the initial SSE connection from reconnections', () => {
    class EventSourceStub {
      static current!: EventSourceStub;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string, _options: EventSourceInit) { EventSourceStub.current = this; }
      close() {}
    }
    vi.stubGlobal('EventSource', EventSourceStub);
    const transport = createFetchTransport({});
    const onReady = vi.fn();
    const onReconnect = vi.fn();
    const stop = transport.subscribe('app', 'workspace', { onInvalidate: vi.fn(), onReady, onReconnect, onError: vi.fn() });
    EventSourceStub.current.onopen?.();
    EventSourceStub.current.onopen?.();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    stop();
  });
});
