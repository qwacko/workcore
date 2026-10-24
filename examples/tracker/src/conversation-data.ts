import { and, desc, eq, sql } from 'drizzle-orm';
import type { ConversationStore } from './tracker-types.js';
import { conversationMessages, conversations } from './db/schema.js';
import { db } from './db/index.js';

export const conversationStore: ConversationStore = {
  async latest(scope, actorId) {
    const [conversation] = await db.select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(and(
        eq(conversations.applicationId, scope.applicationId),
        eq(conversations.workspaceId, scope.workspaceId),
        eq(conversations.actorId, actorId),
      ))
      .orderBy(desc(conversations.updatedAt))
      .limit(1);
    return conversation;
  },
  async get(scope, actorId, conversationId) {
    const [conversation] = await db.select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.applicationId, scope.applicationId),
        eq(conversations.workspaceId, scope.workspaceId),
        eq(conversations.actorId, actorId),
      )).limit(1);
    return conversation;
  },
  async create(scope, actorId, conversation) {
    await db.insert(conversations).values({
      ...conversation,
      applicationId: scope.applicationId,
      workspaceId: scope.workspaceId,
      actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  },
  async listMessages(scope, actorId, conversationId, limit) {
    const rows = await db.select({ message: conversationMessages }).from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .where(and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversations.applicationId, scope.applicationId),
        eq(conversations.workspaceId, scope.workspaceId),
        eq(conversations.actorId, actorId),
      ))
      // SQLite rowid preserves insertion order for timestamp ties; UUID ordering does not.
      // Read the newest bounded window, then return it chronologically for the
      // timeline and model context. Ascending + LIMIT silently froze history at
      // the first messages in long-running conversations.
      .orderBy(desc(conversationMessages.createdAt), desc(sql`tracker_conversation_messages.rowid`))
      .limit(limit);
    return rows.reverse().map(({ message }) => {
      const { runId, ...rest } = message;
      return { ...rest, ...(runId ? { runId } : {}) };
    });
  },
  async addMessage(scope, actorId, message) {
    if (!await this.get(scope, actorId, message.conversationId)) throw new Error('Conversation not found');
    const { conversationId, ...values } = message;
    await db.insert(conversationMessages).values({ ...values, conversationId });
    await db.update(conversations).set({ updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.actorId, actorId), eq(conversations.applicationId, scope.applicationId), eq(conversations.workspaceId, scope.workspaceId)));
  },
  async linkRun(scope, actorId, conversationId, messageId, runId) {
    if (!await this.get(scope, actorId, conversationId)) throw new Error('Conversation not found');
    await db.update(conversationMessages).set({ runId })
      .where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.role, 'assistant')));
  },
  async completeAssistant(scope, actorId, conversationId, messageId, text) {
    if (!await this.get(scope, actorId, conversationId)) throw new Error('Conversation not found');
    await db.update(conversationMessages).set({ text, status: 'complete' })
      .where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.role, 'assistant')));
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
  },
  async failAssistant(scope, actorId, conversationId, messageId) {
    if (!await this.get(scope, actorId, conversationId)) throw new Error('Conversation not found');
    await db.update(conversationMessages).set({ text: 'I hit a snag on that turn. Please try again.', status: 'failed' })
      .where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.role, 'assistant')));
    await db.update(conversations).set({ updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.actorId, actorId), eq(conversations.applicationId, scope.applicationId), eq(conversations.workspaceId, scope.workspaceId)));
  },
};
