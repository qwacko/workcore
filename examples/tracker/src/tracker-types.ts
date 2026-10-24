import type { AgentRunAdapter, Scope } from '@workcore/core';

export type Activity = { id: string; title: string; status: 'planned' | 'complete'; updatedAt: Date };
export type ActivityStore = {
  list(scope: Scope, input: { limit: number; cursor?: string | undefined; status?: Activity['status'] | undefined; search?: string | undefined }): Promise<{ rows: Activity[]; nextCursor: string | null; totalCount: number }>;
  update(scope: Scope, input: { id: string; title: string; status: 'planned' | 'complete' }): Promise<Activity>;
};
export type ActivitySummary = { total: number; complete: number; planned: number };
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
