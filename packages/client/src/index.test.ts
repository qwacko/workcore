import { describe, expect, it } from 'vitest';
import { createFetchTransport } from './index.js';
import type { JsonValue, WireCodec } from '@workcore/core';

describe('fetch transport', () => {
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
});
