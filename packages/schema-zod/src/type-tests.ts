import { chatMessageQuery, tableQuery } from '@workcore/core';
import { z } from 'zod';
import { chatSchemaHelper } from './index.js';

const chat = chatSchemaHelper({ messageType: z.enum(['message', 'prompt']) });
chatMessageQuery({ ...chat, handler: ({ input }) => ({ items: [{ id: input.search ?? 'm1', type: 'message' as const }], nextCursor: null }) });

tableQuery({
  input: z.object({ limit: z.number() }),
  output: z.object({ rows: z.array(z.object({ id: z.string() })), nextCursor: z.string().nullable() }),
  handler: () => ({ rows: [{ id: 'r1' }], nextCursor: null }),
});

// @ts-expect-error Specialized query helpers require their page contract.
chatMessageQuery({ input: z.object({}), output: z.object({ result: z.string() }), handler: () => ({ result: 'not a page' }) });
