import { z } from 'zod';

const jsonValueSchema: z.ZodType = z.json();
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

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
  z.object({ id: z.string().optional(), type: z.literal('image'), url: z.string(), alt: z.string().optional(), mimeType: z.string().optional(), data: jsonObjectSchema.optional() }),
  z.object({ id: z.string().optional(), type: z.literal('file'), url: z.string(), name: z.string(), mimeType: z.string().optional(), size: z.number().nonnegative().optional(), data: jsonObjectSchema.optional() }),
  z.object({ id: z.string().optional(), type: z.literal('link'), url: z.string(), label: z.string().optional(), data: jsonObjectSchema.optional() }),
  z.object({ id: z.string().optional(), type: z.literal('tool'), name: z.string(), state: z.enum(['input-available', 'output-available', 'output-error']), input: jsonValueSchema.optional(), output: jsonValueSchema.optional() }),
]);

const actionSchema = z.object({ id: z.string(), label: z.string(), mutation: z.string(), variant: z.string().optional(), input: jsonValueSchema.optional(), disabled: z.boolean().optional(), disabledReason: z.string().optional(), confirm: z.string().optional() });

export type ChatSchemaHelperOptions<
  MessageType extends z.ZodType = typeof defaultMessageType,
  MessageStatus extends z.ZodType = typeof defaultMessageStatus,
  MessageData extends z.ZodType = typeof jsonObjectSchema,
  PageData extends z.ZodType = typeof jsonObjectSchema,
  Filters extends z.ZodType = typeof jsonObjectSchema,
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
>(options: ChatSchemaHelperOptions<MessageType, MessageStatus, MessageData, PageData, Filters> = {}) {
  const messageType = options.messageType ?? defaultMessageType;
  const messageStatus = options.messageStatus ?? defaultMessageStatus;
  const messageData = options.messageData ?? jsonObjectSchema;
  const pageData = options.pageData ?? jsonObjectSchema;
  const sectionData = options.sectionData ?? jsonObjectSchema;
  const filters = options.filters ?? jsonObjectSchema;
  const contentPart = options.contentPart ? z.union([contentPartSchema, options.contentPart]) : contentPartSchema;
  const message = z.object({
    id: z.string(), type: messageType, threadId: z.string().optional(), replyToMessageId: z.string().optional(),
    sender: actorSchema.optional(), role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    createdAt: z.iso.datetime().optional(), editedAt: z.iso.datetime().optional(), preview: z.string().optional(), status: messageStatus.optional(),
    runId: z.string().optional(),
    sections: z.array(z.object({ id: z.string(), title: z.string().optional(), parts: z.array(contentPart), data: sectionData.optional() })).optional(),
    parts: z.array(contentPart).optional(), actions: z.array(actionSchema).optional(), data: messageData.optional(),
  });
  const input = z.object({
    search: z.string().optional(), limit: z.number().int().min(1).max(options.maxLimit ?? 200).default(options.defaultLimit ?? 50),
    cursor: z.string().optional(), direction: z.enum(['forward', 'backward']).optional(),
    filters: filters.optional(), types: z.array(messageType).optional(), statuses: z.array(messageStatus).optional(),
    threadId: z.string().optional(), participantId: z.string().optional(), before: z.iso.datetime().optional(), after: z.iso.datetime().optional(),
  });
  const output = z.object({
    items: z.array(message), messages: z.array(message).optional(), nextCursor: z.string().nullable(), previousCursor: z.string().nullable().optional(),
    totalCount: z.number().int().nonnegative().optional(), data: pageData.optional(),
  });
  return { input, output };
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
    input: z.object({ search: z.string().optional(), limit: z.number().int().min(1).max(options.maxLimit ?? 200).default(options.defaultLimit ?? 50), cursor: z.string().optional(), direction: z.enum(['forward', 'backward']).optional(), filters: filters.optional(), statuses: z.array(status).optional(), participantId: z.string().optional() }),
    output: z.object({ items: z.array(thread), threads: z.array(thread).optional(), nextCursor: z.string().nullable(), previousCursor: z.string().nullable().optional(), totalCount: z.number().int().nonnegative().optional(), data: pageData.optional() }),
  };
}

/** Compose an application-defined thread schema with a paged thread-detail message timeline. */
export function chatThreadDetailSchemaHelper<Thread extends z.ZodType, Message extends z.ZodType, Data extends z.ZodType = typeof jsonObjectSchema>(options: {
  thread: Thread;
  message: Message;
  data?: Data;
  defaultLimit?: number;
  maxLimit?: number;
}) {
  const data = options.data ?? jsonObjectSchema;
  return {
    input: z.object({
      threadId: z.string(), limit: z.number().int().min(1).max(options.maxLimit ?? 200).default(options.defaultLimit ?? 50),
      cursor: z.string().optional(), direction: z.enum(['forward', 'backward']).optional(),
    }),
    output: z.object({
      thread: options.thread.nullable(), messages: z.array(options.message), nextCursor: z.string().nullable(),
      previousCursor: z.string().nullable().optional(), data: data.optional(),
    }),
  };
}

export { contentPartSchema as chatContentPartSchema, actionSchema as chatActionSchema };
