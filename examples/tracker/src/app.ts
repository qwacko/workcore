import { defineWorkspace, type AgentRunAdapter, type Scope } from '@workcore/core';
import { chatMessageZodQuery, chatSchemaHelper, cursorTableZodQuery } from '@workcore/schema-zod';
import { z } from 'zod';
import { roleCanUseWorkcoreCapability } from './demo-workspaces.js';

export type Activity = { id: string; title: string; status: 'planned' | 'complete'; updatedAt: Date };
export type ActivityStore = {
  list(scope: { applicationId: string; workspaceId: string }, input: { limit: number; cursor?: string | undefined; status?: Activity['status'] | undefined; search?: string | undefined }): Promise<{ rows: Activity[]; nextCursor: string | null; totalCount: number }>;
  update(scope: { applicationId: string; workspaceId: string }, input: { id: string; title: string; status: 'planned' | 'complete' }): Promise<Activity>;
};
export type Conversation = { id: string; title: string };
export type ConversationMessage = { id: string; role: 'user' | 'assistant'; text: string; status: 'complete' | 'streaming' | 'failed'; runId?: string; createdAt: Date };
export type ConversationStore = {
  latest(scope: Scope, actorId: string): Promise<Conversation | undefined>;
  get(scope: Scope, actorId: string, conversationId: string): Promise<Conversation | undefined>;
  create(scope: Scope, actorId: string, conversation: Conversation): Promise<void>;
  listMessages(scope: Scope, actorId: string, conversationId: string, limit: number): Promise<ConversationMessage[]>;
  addMessage(scope: Scope, actorId: string, message: ConversationMessage & { conversationId: string }): Promise<void>;
  linkRun(scope: Scope, actorId: string, conversationId: string, messageId: string, runId: string): Promise<void>;
  completeAssistant(scope: Scope, actorId: string, conversationId: string, messageId: string, text: string): Promise<void>;
  failAssistant(scope: Scope, actorId: string, conversationId: string, messageId: string): Promise<void>;
};
export type TrackerContext = { activities: ActivityStore; conversations: ConversationStore; agentRuns: Pick<AgentRunAdapter, 'get'> };
const trackerAuthorizationContext = z.object({ userId: z.string(), role: z.enum(['owner', 'viewer']), isAdmin: z.boolean() });
export type TrackerAuthorization = z.output<typeof trackerAuthorizationContext>;
const dateSchema = z.date().meta({ type: 'string', format: 'date-time', 'x-workcore-runtimeType': 'date' });
const activityRow = z.object({ id: z.string(), title: z.string(), status: z.enum(['planned', 'complete']), updatedAt: dateSchema });
const activitySchema = activityRow;
const dateEchoInput = z.object({ at: dateSchema.meta({ default: '2026-10-12T10:00:00.000Z' }) });
const dateTimeTextInput = z.object({ at: z.iso.datetime().meta({ default: '2026-10-12T10:00:00.000Z' }) });
const dateOutput = dateSchema;
const richValueOutput = z.custom<Record<string, unknown>>((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)).meta({ type: 'object' });
const activityFilters = z.object({ status: z.enum(['planned', 'complete']).optional(), search: z.string().max(120).optional() });
const editInput = z.object({ id: z.string().min(1), title: z.string().min(1).max(120), status: z.enum(['planned', 'complete']) });
const emptyInput = z.object({});
const summarySchema = z.object({ total: z.number(), complete: z.number(), planned: z.number() });
const chatSchemas = chatSchemaHelper({
  messageStatus: z.enum(['complete', 'streaming', 'failed']),
  conversation: z.object({ id: z.string(), title: z.string() }),
  activeRuns: z.array(z.object({ runId: z.string(), status: z.string() })),
});
const sendMessageInput = z.object({ message: z.string().trim().min(1).max(2_000), conversationId: z.string().optional() });
const sendMessageOutput = z.object({ conversationId: z.string(), runId: z.string() });
const agentInput = z.object({ conversationId: z.string(), assistantMessageId: z.string(), userMessage: z.string() });
const assistantReplyInput = z.object({ conversationId: z.string(), assistantMessageId: z.string(), text: z.string().min(1).max(2_000) });
const conversationHistoryInput = z.object({ conversationId: z.string() });
const conversationHistoryOutput = z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() }));
const successOutput = z.object({ ok: z.boolean() });

export const tracker = defineWorkspace<TrackerContext>()({
  id: 'tracker',
  admin: ({ ui, queries, mutations }) => ({
    defaultPage: 'operations',
    pages: {
      activityDashboard: ui.page({
        title: 'Activity dashboard',
        description: 'A focused view assembled from the workspace operation catalog.',
        layout: 'two-column',
        blocks: [
          queries.activities.view('basic', { id: 'recent-activities', input: { limit: 10 } }),
          { id: 'standalone-activity-editor', type: 'mutation-form', operation: mutations.editActivity.name, title: 'Edit an activity' },
        ],
      }),
      activitySearch: ui.page({
        title: 'Activity search',
        description: 'Page-owned search and status controls are bound into the activities query input.',
        layout: 'stacked',
        state: {
          searchText: { type: 'text', label: 'Search activities', default: '' },
          status: { type: 'select', label: 'Activity status', default: '', options: [
            { value: '', label: 'All statuses' },
            { value: 'planned', label: 'Planned' },
            { value: 'complete', label: 'Complete' },
          ] },
        },
        blocks: [queries.activities.view('basic', {
          id: 'search-results',
          input: { limit: 25 },
          inputBindings: { search: { state: 'searchText' }, status: { state: 'status' } },
        })],
      }),
      miloCampfire: ui.page({
        title: "Milo's Campfire",
        description: 'A friendly, outdoors-loving trail buddy. Conversations are saved to your tracker workspace.',
        layout: 'stacked',
        blocks: [queries.assistantConversation.view('chat', { id: 'milo-chat', input: {} })],
      }),
      workspaceHistory: ui.page({
        title: 'Workspace history',
        description: 'A custom page composed with the platform history resource.',
        layout: 'stacked',
        blocks: [{ id: 'history-resource', type: 'resource', resource: 'history', title: 'Recent activity' }],
      }),
      operationWorkbench: ui.page({
        title: 'Operation workbench',
        description: 'An application-authored operation catalog and checked executor composition.',
        layout: 'two-column',
        blocks: [ui.operationCatalog({ id: 'available-operations', selection: 'workbench' }), ui.operationExecutor({ id: 'operation-runner', selection: 'workbench' })],
      }),
      rendererExtension: ui.page({
        title: 'Renderer extension',
        description: 'A versioned, renderer-independent custom component descriptor.',
        layout: 'stacked',
        blocks: [{ id: 'activity-summary', type: 'custom', component: 'tracker/activity-summary', version: 1, title: 'Activity summary', description: 'A custom renderer can replace this placeholder with an activity summary.', props: { query: 'activities' } }],
      }),
    },
  }),
  authorization: {
    context: trackerAuthorizationContext,
    check: ({ auth, permission }) => auth.isAdmin || auth.role === 'owner' || permission === 'activities.read' || permission === 'assistant.chat' || permission === 'notes.read' || (permission.startsWith('workcore.') && roleCanUseWorkcoreCapability(auth.role, permission)),
  },
  queries: {
    assistantConversation: chatMessageZodQuery<TrackerContext>()({
      ...chatSchemas,
      views: {
        default: 'chat',
        variants: {
          chat: {
            title: "Milo's Campfires",
            subtitle: 'A friendly trail buddy for whatever is on your mind.',
            renderer: 'chat',
            chat: {
              sendMutation: 'sendAssistantMessage',
              messageInput: 'message',
              conversationIdInput: 'conversationId',
              conversationQueryInput: 'conversationId',
              conversationIdPath: 'conversation.id',
              conversationIdResultPath: 'conversationId',
            },
          },
        },
      },
      permission: 'assistant.chat',
      api: true,
      handler: async ({ ctx, input }) => {
        const conversation = input.conversationId
          ? await ctx.app.conversations.get(ctx.scope, ctx.actor.id, input.conversationId)
          : await ctx.app.conversations.latest(ctx.scope, ctx.actor.id);
        if (!conversation) return { conversation: null, items: [], activeRuns: [], nextCursor: null };
        const storedMessages = await ctx.app.conversations.listMessages(ctx.scope, ctx.actor.id, conversation.id, 100);
        const activeRuns: Array<{ runId: string; status: string }> = [];
        const messages: ConversationMessage[] = [];
        for (const message of storedMessages) {
          if (message.role !== 'assistant' || message.status !== 'streaming' || !message.runId) {
            messages.push(message);
            continue;
          }
          const run = await ctx.app.agentRuns.get(ctx.scope, message.runId);
          if (run?.status === 'queued' || run?.status === 'running') {
            activeRuns.push({ runId: run.id, status: run.status });
            messages.push(message);
          } else {
            // Project terminal run state into the read-only query; do not mutate app data here.
            messages.push({ ...message, status: 'failed', text: message.text || 'I hit a snag on that turn. Please try again.' });
          }
        }
        const projectedMessages = messages.map((message) => ({
          id: message.id,
          type: 'message' as const,
          role: message.role,
          createdAt: message.createdAt.toISOString(),
          status: message.status,
          ...(message.runId ? { runId: message.runId } : {}),
          parts: [{ type: 'text' as const, text: message.text }],
        }));
        return {
          conversation,
          items: projectedMessages,
          activeRuns,
          nextCursor: null,
        };
      },
    }),
    conversationHistory: {
      input: conversationHistoryInput,
      output: conversationHistoryOutput,
      permission: 'assistant.chat',
      handler: async ({ ctx, input }) => (await ctx.app.conversations.listMessages(ctx.scope, ctx.actor.id, input.conversationId, 12)).map(({ role, text }) => ({ role, text })),
    },
    activities: {
      ...cursorTableZodQuery<TrackerContext, typeof activityFilters.shape, typeof activityRow>({
        input: activityFilters,
        row: activityRow,
        defaultLimit: 25,
        maxLimit: 100,
        permission: 'activities.read',
        api: true,
        handler: ({ ctx, input }) => ctx.app.activities.list(ctx.scope, input),
      }),
      views: {
        default: 'manage',
        variants: {
          basic: { title: 'Activities', renderer: 'table', rowKey: 'id', columns: ['title', 'status', 'updatedAt'], collection: { itemKey: 'id', titleField: 'title', subtitleField: 'status', columns: [{ field: 'title', editable: true, filter: { type: 'text', targetParam: 'search' } }, { field: 'status', display: 'badge', editable: true }, { field: 'updatedAt', display: 'datetime', editable: false }], actions: [{ label: 'Edit activity', mutation: 'editActivity', variant: 'basic', bind: { id: { fromRow: 'id' } } }], editor: { mutation: 'editActivity', variant: 'basic', identity: { rowField: 'id', targetInput: 'id' } } } },
          compact: { title: 'Recent activities', subtitle: 'Latest workspace activity', renderer: 'table', rowKey: 'id', columns: ['title', 'status'] },
          manage: { title: 'Manage activities', renderer: 'table', rowKey: 'id', columns: ['title', 'status', 'updatedAt'], collection: { itemKey: 'id', titleField: 'title', subtitleField: 'status', columns: [{ field: 'title', editable: true, filter: { type: 'text', targetParam: 'search' } }, { field: 'status', editable: true, filter: { type: 'select' } }, { field: 'updatedAt', display: 'datetime', editable: false }], actions: [{ label: 'Edit activity', mutation: 'editActivity', variant: 'basic', bind: { id: { fromRow: 'id' } } }], editor: { mutation: 'editActivity', variant: 'basic' } } },
          dataOnly: { title: 'Activity data', renderer: 'json' },
        },
      },
    },
    dateRoundTrip: {
      input: dateEchoInput,
      output: dateOutput,
      permission: 'activities.read',
      api: true,
      views: { default: 'basic', variants: { basic: { title: 'Date round trip', renderer: 'json' } } },
      handler: ({ input }) => input.at,
    },
    dateTimeText: {
      input: dateTimeTextInput,
      output: z.string(),
      permission: 'activities.read',
      api: true,
      views: { default: 'basic', variants: { basic: { title: 'Date-time text', renderer: 'json' } } },
      handler: ({ input }) => input.at,
    },
    richValues: {
      input: emptyInput,
      output: richValueOutput,
      permission: 'activities.read',
      api: true,
      views: { default: 'basic', variants: { basic: { title: 'Rich value viewer', renderer: 'json' } } },
      handler: () => {
        const value: Record<string, unknown> = { big: 42n, map: new Map([['key', 'value']]), set: new Set(['member']) };
        value.self = value;
        return value;
      },
    },
  },
  mutations: {
    sendAssistantMessage: {
      input: sendMessageInput,
      output: sendMessageOutput,
      permission: 'assistant.chat',
      api: true,
      handler: async ({ ctx, input, operations }) => {
        let conversation: Conversation | undefined;
        if (input.conversationId) {
          conversation = await ctx.app.conversations.get(ctx.scope, ctx.actor.id, input.conversationId);
          if (!conversation) throw new Error('Conversation not found');
        } else {
          conversation = { id: crypto.randomUUID(), title: input.message.slice(0, 72) };
          await ctx.app.conversations.create(ctx.scope, ctx.actor.id, conversation);
        }
        const now = new Date();
        await ctx.app.conversations.addMessage(ctx.scope, ctx.actor.id, {
          id: crypto.randomUUID(), conversationId: conversation.id, role: 'user', text: input.message, status: 'complete', createdAt: now,
        });
        const assistantMessageId = crypto.randomUUID();
        await ctx.app.conversations.addMessage(ctx.scope, ctx.actor.id, {
          id: assistantMessageId, conversationId: conversation.id, role: 'assistant', text: '', status: 'streaming', createdAt: new Date(),
        });
        try {
          const { runId } = await operations.enqueueAgent('milo', { conversationId: conversation.id, assistantMessageId, userMessage: input.message }, { conversationId: conversation.id });
          await ctx.app.conversations.linkRun(ctx.scope, ctx.actor.id, conversation.id, assistantMessageId, runId);
          return { conversationId: conversation.id, runId };
        } catch (cause) {
          await ctx.app.conversations.failAssistant(ctx.scope, ctx.actor.id, conversation.id, assistantMessageId);
          throw cause;
        }
      },
    },
    saveAssistantReply: {
      input: assistantReplyInput,
      output: successOutput,
      permission: 'assistant.chat',
      handler: async ({ ctx, input }) => {
        await ctx.app.conversations.completeAssistant(ctx.scope, ctx.actor.id, input.conversationId, input.assistantMessageId, input.text);
        return { ok: true };
      },
    },
    editActivity: {
      input: editInput,
      output: activitySchema,
      permission: 'activities.write',
      api: true,
      views: { default: 'basic', variants: { basic: { title: 'Edit activity', renderer: 'form' } } },
      handler: ({ ctx, input }) => ctx.app.activities.update(ctx.scope, input),
    }
  },
  tasks: {
    refreshSummary: {
      input: emptyInput,
      output: summarySchema,
      permission: 'summary.refresh',
      api: true,
      triggers: { mutations: ['editActivity'] },
      views: { default: 'basic', variants: { basic: { title: 'Refresh summary', renderer: 'form' } } },
      handler: async ({ ctx, operations }) => {
        await ctx.services.tasks.reportProgress(0);
        const activities: Activity[] = [];
        let cursor: string | undefined;
        do {
          const page = await operations.query('activities', { limit: 100, ...(cursor ? { cursor } : {}) });
          activities.push(...page.rows);
          cursor = page.nextCursor ?? undefined;
          await ctx.services.tasks.reportProgress(cursor ? 50 : 90);
        } while (cursor);
        const summary = { total: activities.length, complete: activities.filter((activity) => activity.status === 'complete').length, planned: activities.filter((activity) => activity.status === 'planned').length };
        await ctx.services.kv.set('activity-summary', summary);
        await ctx.services.tasks.reportProgress(100);
        return summary;
      },
    },
  },
  agents: {
    milo: {
      input: agentInput,
      permission: 'assistant.chat',
      model: process.env.WORKCORE_AGENT_MODEL ?? 'anthropic/claude-3.5-sonnet',
      instructions: [
        'You are Milo, a cheerful, outdoors-loving trail buddy with a calm sense of humor.',
        'Be warm, curious, concise, and encouraging. Use an occasional trail or campfire metaphor, never force one.',
        'Remember the conversation history and respond naturally to follow-up questions.',
        'Do not claim to know live weather, locations, or facts you were not given.',
        'To finish, call mutation.saveAssistantReply with the exact conversationId and assistantMessageId from the request and your reply as text.',
      ].join(' '),
      prompt: async ({ ctx, input }) => {
          const history = await ctx.app.conversations.listMessages(ctx.scope, ctx.actor.id, input.conversationId, 12);
        return JSON.stringify({
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          userMessage: input.userMessage,
          recentMessages: history.filter((message) => message.text).map(({ role, text }) => ({ role, text })),
        });
      },
      tools: [
        { kind: 'query', operation: 'conversationHistory', description: 'Read recent messages in this conversation.' },
        { kind: 'mutation', operation: 'saveAssistantReply', description: 'Save Milo’s reply and complete this turn.' },
      ],
      finishWhen: { tool: 'mutation.saveAssistantReply' },
      maxSteps: 4,
      maxOutputTokens: 900,
    },
  },
});
