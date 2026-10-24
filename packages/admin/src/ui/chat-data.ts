import type { ChatMessage, ChatThread, OperationViewVariant, SemanticManifestPage } from '@workcore/core';
import { parseEditableJson, richJson } from './rich-input.js';
import { fieldPath as pathValue } from './field-path.js';

export { pathValue };

export function safeMarkdown(markdown: string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  let html = escape(markdown);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (whole, label: string, rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return label;
      return `<a href="${escape(parsed.toString())}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    } catch { return whole; }
  });
  return html.replace(/\n/g, '<br>');
}

/** Allow web/mail links and same-origin relative paths, never executable or protocol-relative URLs. */
export function safeChatUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u001f\\]/.test(candidate) || candidate.startsWith('//')) return null;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? candidate : null;
  } catch {
    return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : null;
  }
}

export function chatMessages(value: unknown): ChatMessage[] {
  if (!value || typeof value !== 'object') return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items as ChatMessage[] : [];
}

export function chatThreads(value: unknown): ChatThread[] {
  if (!value || typeof value !== 'object') return [];
  const page = value as { thread?: unknown; items?: unknown };
  if (page.thread && typeof page.thread === 'object' && !Array.isArray(page.thread)) return [page.thread as ChatThread];
  return Array.isArray(page.items) ? page.items as ChatThread[] : [];
}

export function previousCursor(value: unknown): string | null {
  const cursor = pathValue(value, 'previousCursor');
  return typeof cursor === 'string' ? cursor : null;
}

export function nextCursor(value: unknown): string | null {
  const cursor = pathValue(value, 'nextCursor');
  return typeof cursor === 'string' ? cursor : null;
}

/** Resolve a chat navigation intent only against pages and state declarations in the visible manifest. */
export function validateChatNavigation(pages: readonly SemanticManifestPage[], pageId: string, stateValues: Record<string, string>) {
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error('This chat link points to a page that is not available to your account.');
  for (const [name, value] of Object.entries(stateValues)) {
    const declaration = Object.hasOwn(page.state ?? {}, name) ? page.state?.[name] : undefined;
    if (!declaration || typeof value !== 'string') throw new Error(`This chat link contains an invalid state value for '${name}'.`);
    if (declaration.type === 'select' && !declaration.options.some((option) => option.value === value)) throw new Error(`This chat link contains an unavailable value for '${name}'.`);
  }
  return { pageId, stateValues };
}

export function activeRuns(value: unknown): Array<{ runId: string; status: string }> {
  const runs = pathValue(value, 'activeRuns') ?? pathValue(value, 'data.activeRuns');
  return Array.isArray(runs) ? runs as Array<{ runId: string; status: string }> : [];
}

/** Pagination changes do not select another timeline; user filters do. */
export function chatTimelineKey(contextKey: string, inputText: string, value: unknown, variant: OperationViewVariant): string {
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

export function chatMutationInput(chat: NonNullable<OperationViewVariant['chat']> & { messageInput: string }, text: string, conversationId: unknown, contextValue?: unknown): Record<string, unknown> {
  const input: Record<string, unknown> = { [chat.messageInput]: text.trim() };
  if (chat.conversationIdInput && conversationId != null) input[chat.conversationIdInput] = conversationId;
  for (const [key, binding] of Object.entries(chat.inputBindings ?? {})) {
    const value = 'value' in binding ? binding.value : pathValue(contextValue, 'fromConversation' in binding ? binding.fromConversation : binding.fromThread);
    if (value !== undefined) input[key] = value;
  }
  return input;
}
