import { cursorTableQuery, offsetTableQuery, type AnySchema, type OperationCaller, type OperationViews, type QueryDefinition } from '@workcore/core';
import { z } from 'zod';
export { cursorTableQuery, offsetTableQuery } from '@workcore/core';

export type TableSchemaHelperOptions<Input extends z.ZodRawShape, Row extends z.ZodType> = {
  /** Application-specific query inputs. Pagination fields are added by the helper. */
  input: z.ZodObject<Input>;
  row: Row;
  defaultLimit?: number;
  maxLimit?: number;
};

function pageLimit(options: { maxLimit?: number; defaultLimit?: number }, maximum = Number.MAX_SAFE_INTEGER) {
  const max = options.maxLimit ?? 200;
  const initial = options.defaultLimit ?? 50;
  if (!Number.isSafeInteger(initial) || initial < 1 || !Number.isSafeInteger(max) || max < initial || max > maximum) throw new RangeError(`Page limits must satisfy 1 <= defaultLimit <= maxLimit <= ${maximum}`);
  return z.number().int().min(1).max(max).default(initial);
}

/** Build a cursor-paged table contract; handlers receive `limit`/`cursor`. */
export function cursorTableSchemaHelper<Input extends z.ZodRawShape, Row extends z.ZodType>(options: TableSchemaHelperOptions<Input, Row>) {
  const limit = pageLimit(options, 200);
  const base = options.input;
  if (Object.hasOwn(base.shape, 'limit') || Object.hasOwn(base.shape, 'cursor')) throw new TypeError('Table schema input already defines reserved pagination field');
  return {
    input: z.object({ limit, cursor: z.string().optional(), ...base.shape }),
    output: z.object({ rows: z.array(options.row), nextCursor: z.string().nullable(), totalCount: z.number().int().nonnegative().optional() }),
  };
}

/** Build an offset-paged table contract; handlers receive `limit`/`offset`. */
export function offsetTableSchemaHelper<Input extends z.ZodRawShape, Row extends z.ZodType>(options: TableSchemaHelperOptions<Input, Row>) {
  const limit = pageLimit(options, 200);
  const base = options.input;
  if (Object.hasOwn(base.shape, 'limit') || Object.hasOwn(base.shape, 'offset')) throw new TypeError('Table schema input already defines reserved pagination field');
  return {
    input: z.object({ limit, offset: z.number().int().min(0).default(0), ...base.shape }),
    output: z.object({ rows: z.array(options.row), totalCount: z.number().int().nonnegative() }),
  };
}

type CursorTableSchemas<Input extends z.ZodRawShape, Row extends z.ZodType> = ReturnType<typeof cursorTableSchemaHelper<Input, Row>>;
type OffsetTableSchemas<Input extends z.ZodRawShape, Row extends z.ZodType> = ReturnType<typeof offsetTableSchemaHelper<Input, Row>>;
type ZodTableQueryOptions<App, Input extends z.ZodRawShape, Row extends z.ZodType, Schemas extends { input: AnySchema; output: AnySchema }, Tools> = {
  input: z.ZodObject<Input>;
  row: Row;
  defaultLimit?: number;
  maxLimit?: number;
  api?: boolean;
  permission?: QueryDefinition<App, Schemas['input'], Schemas['output'], Tools>['permission'];
  handler: QueryDefinition<App, Schemas['input'], Schemas['output'], Tools>['handler'];
};

/** One-call Zod convenience for cursor-paged queries. Add `views` on the surrounding query definition when custom views are needed. */
export function cursorTableZodQuery<App, Input extends z.ZodRawShape, Row extends z.ZodType, Tools = OperationCaller>(options: ZodTableQueryOptions<App, Input, Row, CursorTableSchemas<Input, Row>, Tools>): Omit<QueryDefinition<App, CursorTableSchemas<Input, Row>['input'], CursorTableSchemas<Input, Row>['output'], Tools>, 'views'> & { readonly kind: 'query' } {
  const schemas = cursorTableSchemaHelper(options);
  return cursorTableQuery<App, typeof schemas.input, typeof schemas.output, Tools>({
    ...schemas,
    ...(options.api === undefined ? {} : { api: options.api }),
    ...(options.permission === undefined ? {} : { permission: options.permission }),
    handler: options.handler,
  });
}

/** One-call Zod convenience for offset-paged queries. Add `views` on the surrounding query definition when custom views are needed. */
export function offsetTableZodQuery<App, Input extends z.ZodRawShape, Row extends z.ZodType, Tools = OperationCaller>(options: ZodTableQueryOptions<App, Input, Row, OffsetTableSchemas<Input, Row>, Tools>): Omit<QueryDefinition<App, OffsetTableSchemas<Input, Row>['input'], OffsetTableSchemas<Input, Row>['output'], Tools>, 'views'> & { readonly kind: 'query' } {
  const schemas = offsetTableSchemaHelper(options);
  return offsetTableQuery<App, typeof schemas.input, typeof schemas.output, Tools>({
    ...schemas,
    ...(options.api === undefined ? {} : { api: options.api }),
    ...(options.permission === undefined ? {} : { permission: options.permission }),
    handler: options.handler,
  });
}

const jsonValueSchema: z.ZodType = z.json();
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const defaultConversationSchema = z.object({ id: z.string(), title: z.string().optional(), revision: z.number().optional(), data: jsonObjectSchema.optional() });
const defaultActiveRunsSchema = z.array(z.object({ runId: z.string(), status: z.string() }));
const defaultThreadSchema = z.object({ id: z.string(), title: z.string().optional() }).passthrough();

const defaultMessageType = z.enum(['message', 'prompt', 'notice', 'action-list', 'agent-activity']);
const defaultMessageStatus = z.object({
  delivery: z.enum(['pending', 'sent', 'failed']).optional(),
  visibility: z.enum(['visible', 'deleted', 'hidden']).optional(),
  activity: z.enum(['queued', 'running', 'complete', 'interrupted']).optional(),
}).passthrough();

const actorSchema = z.object({
  id: z.string(), kind: z.string(), name: z.string().optional(), avatarUrl: z.string().optional(), data: jsonObjectSchema.optional(),
});

const contentPartSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().optional(), type: z.literal('text'), text: z.string() }),
  z.object({ id: z.string().optional(), type: z.literal('markdown'), content: z.string() }),
  z.object({ id: z.string().optional(), type: z.literal('image'), url: z.string(), alt: z.string().optional(), mimeType: z.string().optional(), data: jsonObjectSchema.optional() }),
  z.object({ id: z.string().optional(), type: z.literal('file'), url: z.string(), name: z.string(), mimeType: z.string().optional(), size: z.number().nonnegative().optional(), data: jsonObjectSchema.optional() }),
  z.object({ id: z.string().optional(), type: z.literal('link'), url: z.string(), label: z.string().optional(), data: jsonObjectSchema.optional() }),
  z.object({ id: z.string().optional(), type: z.literal('navigation'), page: z.string().min(1), label: z.string().min(1), state: z.record(z.string(), z.string()).optional() }),
  z.object({ id: z.string().optional(), type: z.literal('tool'), name: z.string(), state: z.enum(['input-available', 'output-available', 'output-error']), input: jsonValueSchema.optional(), output: jsonValueSchema.optional() }),
  z.object({ id: z.string().optional(), type: z.literal('queryView'), query: z.string().min(1), view: z.string().optional(), input: jsonValueSchema.optional(), title: z.string().optional() }),
  z.object({ id: z.string().optional(), type: z.literal('customLayout'), version: z.number().int().positive(), layout: jsonValueSchema, title: z.string().optional() }),
]);

const actionSchema = z.object({ id: z.string(), label: z.string(), input: jsonValueSchema.optional(), disabled: z.boolean().optional(), disabledReason: z.string().optional(), confirm: z.string().optional() });

export type ChatSchemaHelperOptions<
  MessageType extends z.ZodType = typeof defaultMessageType,
  MessageStatus extends z.ZodType = typeof defaultMessageStatus,
  MessageData extends z.ZodType = typeof jsonObjectSchema,
  PageData extends z.ZodType = typeof jsonObjectSchema,
  Filters extends z.ZodType = typeof jsonObjectSchema,
  Conversation extends z.ZodType = typeof defaultConversationSchema,
  ActiveRuns extends z.ZodType = typeof defaultActiveRunsSchema,
  Thread extends z.ZodType = typeof defaultThreadSchema,
> = {
  /** Shared by the returned message type and the input type/status filters. */
  messageType?: MessageType;
  messageStatus?: MessageStatus;
  messageData?: MessageData;
  sectionData?: z.ZodType;
  pageData?: PageData;
  /** Application-owned filter fields; the helper adds type/status filters alongside them. */
  filters?: Filters;
  contentPart?: z.ZodType;
  /** Optional typed thread/conversation context returned with each chat query. */
  conversation?: Conversation;
  activeRuns?: ActiveRuns;
  thread?: Thread;
  defaultLimit?: number;
  maxLimit?: number;
};

/**
 * Build a reusable chat message page contract. The returned `{ input, output }`
 * can be spread directly into a Workcore query; handlers still implement search,
 * filtering, authorization, and cursor semantics.
 */
export function chatSchemaHelper<
  MessageType extends z.ZodType = typeof defaultMessageType,
  MessageStatus extends z.ZodType = typeof defaultMessageStatus,
  MessageData extends z.ZodType = typeof jsonObjectSchema,
  PageData extends z.ZodType = typeof jsonObjectSchema,
  Filters extends z.ZodType = typeof jsonObjectSchema,
  Conversation extends z.ZodType = typeof defaultConversationSchema,
  ActiveRuns extends z.ZodType = typeof defaultActiveRunsSchema,
  Thread extends z.ZodType = typeof defaultThreadSchema,
>(options: ChatSchemaHelperOptions<MessageType, MessageStatus, MessageData, PageData, Filters, Conversation, ActiveRuns, Thread> = {}) {
  const messageType = (options.messageType ?? defaultMessageType) as MessageType;
  const messageStatus = (options.messageStatus ?? defaultMessageStatus) as MessageStatus;
  const messageData = (options.messageData ?? jsonObjectSchema) as MessageData;
  const pageData = (options.pageData ?? jsonObjectSchema) as PageData;
  const sectionData = options.sectionData ?? jsonObjectSchema;
  const filters = (options.filters ?? jsonObjectSchema) as Filters;
  const contentPart = options.contentPart ? z.union([contentPartSchema, options.contentPart]) : contentPartSchema;
  const message = z.object({
    id: z.string(), type: messageType.optional(), threadId: z.string().optional(), replyToMessageId: z.string().optional(),
    sender: actorSchema.optional(), role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    createdAt: z.iso.datetime().optional(), editedAt: z.iso.datetime().optional(), preview: z.string().optional(), status: messageStatus.optional(),
    runId: z.string().optional(),
    sections: z.array(z.object({ id: z.string(), title: z.string().optional(), parts: z.array(contentPart), data: sectionData.optional() })).optional(),
    parts: z.array(contentPart).optional(), actions: z.array(actionSchema).optional(), data: messageData.optional(),
  });
  const input = z.object({
    search: z.string().optional(), limit: pageLimit(options),
    cursor: z.string().optional(), direction: z.enum(['forward', 'backward']).optional(),
    filters: filters.optional(), types: z.array(messageType).optional(), statuses: z.array(messageStatus).optional(),
    threadId: z.string().optional(), conversationId: z.string().optional(), participantId: z.string().optional(), before: z.iso.datetime().optional(), after: z.iso.datetime().optional(),
  });
  const output = z.object({
    items: z.array(message), nextCursor: z.string().nullable(), previousCursor: z.string().nullable().optional(),
    totalCount: z.number().int().nonnegative().optional(), data: pageData.optional(),
    conversation: ((options.conversation ?? defaultConversationSchema) as Conversation).nullable().optional(),
    thread: ((options.thread ?? defaultThreadSchema) as Thread).nullable().optional(),
    activeRuns: ((options.activeRuns ?? defaultActiveRunsSchema) as ActiveRuns).optional(),
  });
  return { input, output };
}

/** Build a chat-message Zod query with the standard extensible schema and a preconfigured timeline view. */
export function chatMessageZodQuery<App, Tools = OperationCaller>() {
  type DefaultViews = { default: 'timeline'; variants: { timeline: { title: string; renderer: 'chat-messages' } } };
  type ChatOptions = { input: AnySchema; output: AnySchema; title?: string; views?: OperationViews; api?: boolean; permission?: unknown; handler: (...args: any[]) => unknown };
  return function <Options extends ChatOptions>(options: Options & {
    permission?: QueryDefinition<App, Options['input'], Options['output'], Tools>['permission'];
    handler: QueryDefinition<App, Options['input'], Options['output'], Tools>['handler'];
  } & (import('@workcore/core').OutputOf<Options['output']> extends { items: unknown[]; nextCursor: string | null } ? unknown : never)): Omit<QueryDefinition<App, Options['input'], Options['output'], Tools>, 'views'> & { readonly kind: 'query'; views: Options extends { views: infer Views } ? Views : DefaultViews } {
    const { title, views, ...queryOptions } = options;
    return { ...queryOptions, kind: 'query', views: views ?? { default: 'timeline', variants: { timeline: { title: title ?? 'Messages', renderer: 'chat-messages' } } } } as unknown as Omit<QueryDefinition<App, Options['input'], Options['output'], Tools>, 'views'> & {
      readonly kind: 'query';
      views: Options extends { views: infer Views } ? Views : DefaultViews;
    };
  };
}

export type ChatThreadSchemaHelperOptions<ThreadData extends z.ZodType = typeof jsonObjectSchema, PageData extends z.ZodType = typeof jsonObjectSchema, Filters extends z.ZodType = typeof jsonObjectSchema> = {
  threadData?: ThreadData;
  pageData?: PageData;
  filters?: Filters;
  threadStatus?: z.ZodType;
  defaultLimit?: number;
  maxLimit?: number;
};

/** Build a searchable/filterable paged thread-list contract. */
export function chatThreadSchemaHelper<ThreadData extends z.ZodType = typeof jsonObjectSchema, PageData extends z.ZodType = typeof jsonObjectSchema, Filters extends z.ZodType = typeof jsonObjectSchema>(options: ChatThreadSchemaHelperOptions<ThreadData, PageData, Filters> = {}) {
  const threadData = options.threadData ?? jsonObjectSchema;
  const pageData = options.pageData ?? jsonObjectSchema;
  const filters = options.filters ?? jsonObjectSchema;
  const status = options.threadStatus ?? z.enum(['open', 'archived', 'closed']);
  const thread = z.object({
    id: z.string(), title: z.string().optional(), description: z.string().optional(), status: status.optional(),
    createdAt: z.iso.datetime().optional(), updatedAt: z.iso.datetime().optional(), participants: z.array(actorSchema).optional(),
    lastMessage: z.object({ id: z.string(), type: z.string().optional(), sender: actorSchema.optional(), createdAt: z.iso.datetime().optional(), preview: z.string().optional() }).optional(),
    messageCount: z.number().int().nonnegative().optional(), unreadCount: z.number().int().nonnegative().optional(), actions: z.array(actionSchema).optional(), data: threadData.optional(),
  });
  return {
    input: z.object({ search: z.string().optional(), limit: pageLimit(options), cursor: z.string().optional(), direction: z.enum(['forward', 'backward']).optional(), filters: filters.optional(), statuses: z.array(status).optional(), participantId: z.string().optional() }),
    output: z.object({ items: z.array(thread), nextCursor: z.string().nullable(), previousCursor: z.string().nullable().optional(), totalCount: z.number().int().nonnegative().optional(), data: pageData.optional() }),
  };
}

export { contentPartSchema as chatContentPartSchema, actionSchema as chatActionSchema };
