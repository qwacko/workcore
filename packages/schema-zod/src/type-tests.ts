import { chatMessageQuery, cursorTableQuery, offsetTableQuery } from '@workcore/core';
import { z } from 'zod';
import { chatMessageZodQuery, chatSchemaHelper, cursorTableSchemaHelper, cursorTableZodQuery, offsetTableSchemaHelper, offsetTableZodQuery } from './index.js';

const chat = chatSchemaHelper({ messageType: z.enum(['message', 'prompt']) });
chatMessageQuery({ ...chat, handler: ({ input }) => ({ items: [{ id: input.search ?? 'm1', type: 'message' as const }], nextCursor: null }) });

const cursorTable = cursorTableSchemaHelper({ input: z.object({ status: z.string().optional() }), row: z.object({ id: z.string(), title: z.string() }) });
cursorTableQuery({ ...cursorTable, handler: ({ input }) => {
  const cursor: string | undefined = input.cursor;
  const limit: number = input.limit;
  const status: string | undefined = input.status;
  void cursor; void limit; void status;
  return { rows: [{ id: 'r1', title: 'row' }], nextCursor: null };
} });

const offsetTable = offsetTableSchemaHelper({ input: z.object({}), row: z.object({ id: z.string(), title: z.string() }) });
offsetTableQuery({ ...offsetTable, handler: ({ input }) => {
  const offset: number = input.offset;
  return { rows: [{ id: String(offset), title: 'row' }], totalCount: 1 };
} });

const zodTableInput = z.object({ term: z.string().optional() });
const zodTableRow = z.object({ id: z.string(), title: z.string() });
cursorTableZodQuery<{ value: number }, typeof zodTableInput.shape, typeof zodTableRow>({
  input: zodTableInput,
  row: zodTableRow,
  handler: ({ ctx, input }) => {
    const value: number = ctx.app.value;
    const term: string | undefined = input.term;
    const cursor: string | undefined = input.cursor;
    void value; void term; void cursor;
    return { rows: [{ id: 'r1', title: 'row' }], nextCursor: null };
  },
});

offsetTableZodQuery<{ value: number }, typeof zodTableInput.shape, typeof zodTableRow>({
  input: zodTableInput,
  row: zodTableRow,
  handler: ({ input }) => ({ rows: [{ id: String(input.offset), title: input.term ?? '' }], totalCount: 1 }),
});

const customChat = chatSchemaHelper({
  messageType: z.enum(['message', 'approval']),
  filters: z.object({ ownerId: z.string().optional() }),
});
const parsedOwner = customChat.input.parse({}).filters?.ownerId;
const ownerTypeCheck: string | undefined = parsedOwner;
void ownerTypeCheck;
chatMessageZodQuery<{ value: number }>()({
  ...customChat,
  handler: ({ ctx, input }) => {
    const value: number = ctx.app.value;
    const ownerId: string | undefined = input.filters?.ownerId;
    const cursor: string | undefined = input.cursor;
    void value; void ownerId; void cursor;
    return { items: [{ id: 'm1', type: 'message' as const }], nextCursor: null };
  },
});

// @ts-expect-error Specialized query helpers require their page contract.
chatMessageQuery({ input: z.object({}), output: z.object({ result: z.string() }), handler: () => ({ result: 'not a page' }) });
