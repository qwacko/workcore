import type { ChatMessage, ChatThread, UiVariant } from '@workcore/core';
import { parseEditableJson, richJson } from './rich-input.js';

export function pathValue(value: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value);
}

export function chatMessages(value: unknown): ChatMessage[] {
  if (!value || typeof value !== 'object') return [];
  const page = value as { messages?: unknown; items?: unknown };
  const rows = Array.isArray(page.messages) ? page.messages : page.items;
  return Array.isArray(rows) ? rows as ChatMessage[] : [];
}

export function chatThreads(value: unknown): ChatThread[] {
  if (!value || typeof value !== 'object') return [];
  const page = value as { thread?: unknown; threads?: unknown; items?: unknown };
  if (page.thread && typeof page.thread === 'object' && !Array.isArray(page.thread)) return [page.thread as ChatThread];
  const rows = Array.isArray(page.threads) ? page.threads : page.items;
  return Array.isArray(rows) ? rows as ChatThread[] : [];
}

export function previousCursor(value: unknown): string | null {
  const cursor = pathValue(value, 'previousCursor');
  return typeof cursor === 'string' ? cursor : null;
}

export function activeRuns(value: unknown): Array<{ runId: string; status: string }> {
  const runs = pathValue(value, 'activeRuns');
  return Array.isArray(runs) ? runs as Array<{ runId: string; status: string }> : [];
}

/** Pagination changes do not select another timeline; user filters do. */
export function chatTimelineKey(contextKey: string, inputText: string, value: unknown, variant: UiVariant): string {
  let identity: unknown;
  try {
    const input = parseEditableJson(inputText || '{}');
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const { cursor: _cursor, direction: _direction, ...filters } = input as Record<string, unknown>;
      identity = filters;
    } else identity = input;
  } catch { identity = inputText; }
  const conversationId = pathValue(value, variant.chat?.conversationIdPath ?? 'conversation.id') ?? pathValue(value, 'thread.id');
  return `${contextKey}:${String(conversationId ?? '')}:${richJson(identity)}`;
}

export function chatMutationInput(chat: NonNullable<UiVariant['chat']>, text: string, conversationId: unknown): Record<string, unknown> {
  return { [chat.messageInput]: text.trim(), ...(chat.conversationIdInput && conversationId != null ? { [chat.conversationIdInput]: conversationId } : {}) };
}
