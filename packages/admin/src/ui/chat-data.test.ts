import { describe, expect, it } from 'vitest';
import { chatMessages, chatThreads, chatTimelineKey, chatMutationInput } from './chat-data.js';
import { editableJson } from './rich-input.js';

describe('shared chat data', () => {
  const variant = { title: 'Messages', renderer: 'chat-messages' as const };
  it('normalizes message, thread-list, and thread-detail envelopes', () => {
    const items = [{ id: 'one' }];
    expect(chatMessages({ items })).toEqual(items);
    expect(chatMessages({ messages: items })).toEqual(items);
    expect(chatThreads({ items })).toEqual(items);
    expect(chatThreads({ threads: items })).toEqual(items);
    expect(chatThreads({ thread: items[0] })).toEqual(items);
  });
  it('keys timelines by scope and filters, not pagination', () => {
    const key = chatTimelineKey('workspace:A', '{"search":"one"}', {}, variant);
    expect(chatTimelineKey('workspace:A', '{"search":"one","cursor":"next","direction":"backward"}', {}, variant)).toBe(key);
    expect(chatTimelineKey('workspace:B', '{"search":"one"}', {}, variant)).not.toBe(key);
    expect(chatTimelineKey('workspace:A', '{"search":"two"}', {}, variant)).not.toBe(key);
  });
  it('handles invalid, null and rich-value query input without crashing the renderer', () => {
    for (const input of ['{', 'null', editableJson({ count: 2n })]) {
      expect(() => chatTimelineKey('query', input, {}, variant)).not.toThrow();
    }
  });
  it('builds identical mutation input for Operations and custom-page composers', () => {
    const chat = { sendMutation: 'send', messageInput: 'text', conversationIdInput: 'thread' };
    expect(chatMutationInput(chat, ' hello ', 'one')).toEqual({ text: 'hello', thread: 'one' });
    expect(chatMutationInput(chat, 'hello', null)).toEqual({ text: 'hello' });
  });
});
