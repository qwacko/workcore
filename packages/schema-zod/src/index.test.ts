import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatSchemaHelper, chatThreadDetailSchemaHelper, chatThreadSchemaHelper } from './index.js';

describe('chat schema helpers', () => {
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
    expect(schemas.output.parse({
      items: [{ id: 'm1', type: 'approval', data: { ticketId: 'T-1' } }],
      nextCursor: null,
      data: { matchedCount: 1 },
    }).items[0]?.type).toBe('approval');
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

  it('builds independently searchable thread-list input and output schemas', () => {
    const schemas = chatThreadSchemaHelper({
      threadStatus: z.enum(['open', 'muted', 'archived']),
      filters: z.object({ member: z.string().optional() }),
      threadData: z.object({ externalId: z.string() }),
    });
    expect(schemas.input.parse({ search: 'trail', statuses: ['muted'], filters: { member: 'alice' } }).search).toBe('trail');
    expect(schemas.output.safeParse({ items: [{ id: 't1', status: 'muted', data: { externalId: 'e1' } }], nextCursor: null }).success).toBe(true);
    expect(schemas.output.safeParse({ items: [{ id: 't1', status: 'unknown' }], nextCursor: null }).success).toBe(false);
  });

  it('composes thread metadata and cursor-paged thread messages', () => {
    const detail = chatThreadDetailSchemaHelper({
      thread: z.object({ id: z.string(), data: z.object({ projectId: z.string() }) }),
      message: z.object({ id: z.string(), type: z.string() }),
      data: z.object({ unread: z.number() }),
    });
    expect(detail.input.parse({ threadId: 't1' }).limit).toBe(50);
    expect(detail.output.parse({ thread: { id: 't1', data: { projectId: 'p1' } }, messages: [{ id: 'm1', type: 'message' }], nextCursor: null, data: { unread: 1 } }).thread?.id).toBe('t1');
  });
});
