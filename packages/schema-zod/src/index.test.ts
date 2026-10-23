import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatMessageZodQuery, chatSchemaHelper, chatThreadSchemaHelper, cursorTableSchemaHelper, offsetTableSchemaHelper } from './index.js';

describe('chat schema helpers', () => {
  it('builds a typed chat-message query with the standard timeline presentation', () => {
    const schemas = chatSchemaHelper({
      messageType: z.enum(['message', 'approval']),
      filters: z.object({ ownerId: z.string().optional() }),
    });
    const query = chatMessageZodQuery<{ value: number }>()({
      ...schemas,
      handler: ({ input }) => ({ items: [{ id: 'm1', type: input.types?.[0] ?? 'message' }], nextCursor: null }),
    });
    expect(query.kind).toBe('query');
    expect(query.views).toMatchObject({ default: 'timeline', variants: { timeline: { renderer: 'chat-messages' } } });
    expect(query.input.parse({ filters: { ownerId: 'alice' } }).limit).toBe(50);
    expect(query.output.safeParse({ items: [{ id: 'm1', type: 'approval' }], nextCursor: null }).success).toBe(true);
  });

  it('shares custom message types across query filters and result messages', () => {
    const schemas = chatSchemaHelper({
      messageType: z.enum(['message', 'prompt', 'approval']),
      messageData: z.object({ ticketId: z.string() }),
      filters: z.object({ ownerId: z.string().optional() }),
      pageData: z.object({ matchedCount: z.number() }),
    });
    const input = schemas.input.parse({ types: ['approval'], filters: { ownerId: 'alice' } });
    expect(input.types).toEqual(['approval']);
    expect(schemas.input.safeParse({ types: ['unknown'] }).success).toBe(false);
    const canonical = schemas.output.parse({
      items: [{ id: 'm1', type: 'approval', data: { ticketId: 'T-1' } }],
      nextCursor: null,
      data: { matchedCount: 1 },
      messages: [{ id: 'ignored', type: 'message' }],
    });
    expect(canonical.items[0]?.type).toBe('approval');
    expect(canonical).not.toHaveProperty('messages');
    expect(schemas.output.safeParse({ items: [{ id: 'm2', type: 'approval', data: { ticketId: 1 } }], nextCursor: null }).success).toBe(false);
  });

  it('validates rich sections and extensible JSON message data', () => {
    const { output } = chatSchemaHelper({
      sectionData: z.object({ layoutHint: z.string() }),
      contentPart: z.object({ type: z.literal('map'), points: z.array(z.tuple([z.number(), z.number()])) }),
    });
    const result = output.parse({ items: [{
      id: 'm1', type: 'prompt', sender: { id: 'bot', kind: 'agent' },
      sections: [{ id: 'body', parts: [{ type: 'text', text: 'Choose' }, { type: 'image', url: 'https://example.test/a.gif' }, { type: 'map', points: [[1, 2]] }], data: { layoutHint: 'cards' } }],
      data: { arbitrary: [1, 'two'] },
    }], nextCursor: null });
    expect(result.items[0]?.sections?.[0]?.parts).toHaveLength(3);
  });

  it('validates safe query-view and versioned custom-layout content with conversation metadata', () => {
    const schemas = chatSchemaHelper({
      conversation: z.object({ id: z.string(), title: z.string() }),
      activeRuns: z.array(z.object({ runId: z.string(), status: z.string() })),
    });
    const result = schemas.output.parse({
      conversation: { id: 'thread-1', title: 'Campfire' },
      activeRuns: [{ runId: 'run-1', status: 'running' }],
      items: [{ id: 'm1', type: 'message', parts: [
        { type: 'markdown', content: '**Hello**' },
        { type: 'queryView', query: 'activities', view: 'compact', input: { status: 'planned' } },
        { type: 'navigation', page: 'activity-search', label: 'Search activities', state: { searchText: 'hike', status: 'complete' } },
        { type: 'customLayout', version: 1, layout: { kind: 'columns', children: [] } },
      ] }],
      nextCursor: null,
    });
    expect(result.conversation?.id).toBe('thread-1');
    expect(result.activeRuns).toHaveLength(1);
    expect(schemas.output.safeParse({ items: [{ id: 'm2', type: 'message', parts: [{ type: 'queryView', query: 'https://unsafe.test' }] }], nextCursor: null }).success).toBe(true);
    expect(schemas.output.safeParse({ items: [{ id: 'm2', type: 'message', parts: [{ type: 'customLayout', version: 0, layout: {} }] }], nextCursor: null }).success).toBe(false);
  });

  it('builds independently searchable thread-list input and output schemas', () => {
    const schemas = chatThreadSchemaHelper({
      threadStatus: z.enum(['open', 'muted', 'archived']),
      filters: z.object({ member: z.string().optional() }),
      threadData: z.object({ externalId: z.string() }),
    });
    expect(schemas.input.parse({ search: 'trail', statuses: ['muted'], filters: { member: 'alice' } }).search).toBe('trail');
    const canonical = schemas.output.parse({ items: [{ id: 't1', status: 'muted', data: { externalId: 'e1' } }], nextCursor: null, threads: [{ id: 'legacy' }] });
    expect(canonical.items).toHaveLength(1);
    expect(canonical).not.toHaveProperty('threads');
    expect(schemas.output.safeParse({ items: [{ id: 't1', status: 'unknown' }], nextCursor: null }).success).toBe(false);
  });

  it('returns thread context and paged items in the unified chat contract', () => {
    const detail = chatSchemaHelper({
      thread: z.object({ id: z.string(), data: z.object({ projectId: z.string() }) }),
      pageData: z.object({ unread: z.number() }),
    });
    expect(detail.input.parse({ threadId: 't1' }).limit).toBe(50);
    expect(detail.output.parse({ thread: { id: 't1', data: { projectId: 'p1' } }, items: [{ id: 'm1', type: 'message' }], nextCursor: null, data: { unread: 1 } }).thread?.id).toBe('t1');
  });
});

describe('table schema helpers', () => {
  const row = z.object({ id: z.string(), title: z.string() });
  it('builds a cursor contract with typed app filters and bounded default limit', () => {
    const schemas = cursorTableSchemaHelper({ input: z.object({ status: z.enum(['open', 'done']).optional() }), row });
    expect(schemas.input.parse({}).limit).toBe(50);
    expect(schemas.input.safeParse({ limit: 201 }).success).toBe(false);
    expect(schemas.output.safeParse({ rows: [{ id: 'a', title: 'A' }], nextCursor: null }).success).toBe(true);
  });

  it('builds an offset contract with a nonnegative offset and total count', () => {
    const schemas = offsetTableSchemaHelper({ input: z.object({ status: z.string().optional() }), row, defaultLimit: 20 });
    expect(schemas.input.parse({}).offset).toBe(0);
    expect(schemas.input.parse({}).limit).toBe(20);
    expect(schemas.input.safeParse({ offset: -1 }).success).toBe(false);
    expect(schemas.output.safeParse({ rows: [{ id: 'a', title: 'A' }], totalCount: 1 }).success).toBe(true);
  });

  it('rejects pagination field collisions', () => {
    expect(() => cursorTableSchemaHelper({ input: z.object({ cursor: z.string() }), row })).toThrow(/reserved pagination field/);
  });
});
