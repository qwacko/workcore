import { describe, expect, it } from 'vitest';
import { chatMessages, chatThreads, chatTimelineKey, chatMutationInput, pathValue, safeChatUrl, safeMarkdown, validateChatNavigation } from './chat-data.js';
import { editableJson } from './rich-input.js';

describe('shared chat data', () => {
  it('resolves own data fields without following prototype or malformed paths', () => {
    const value = { rows: [{ name: 'one' }] };
    expect(pathValue(value, 'rows.0.name')).toBe('one');
    for (const path of ['rows..0.name', 'rows.00.name', 'rows.constructor', '__proto__', 'constructor.name', 'toString']) expect(pathValue(value, path)).toBeUndefined();
  });

  it('rejects inherited properties masquerading as page state declarations', () => {
    const pages = [{ id: 'page', title: 'Page', blocks: [], state: {} }];
    expect(() => validateChatNavigation(pages, 'page', { constructor: 'value' })).toThrow(/invalid state/);
    expect(() => validateChatNavigation(pages, 'page', JSON.parse('{"__proto__":"value"}'))).toThrow(/invalid state/);
  });

  const variant = { title: 'Messages', renderer: 'chat-messages' as const };
  it('uses canonical item envelopes for messages and thread lists', () => {
    const items = [{ id: 'one' }];
    expect(chatMessages({ items })).toEqual(items);
    expect(chatThreads({ items })).toEqual(items);
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
    const chat = { sendMutation: 'send', messageInput: 'text', conversationIdInput: 'thread', inputBindings: { channel: { fromConversation: 'conversation.channel' }, fixed: { value: 'web' } } };
    expect(chatMutationInput(chat, ' hello ', 'one', { conversation: { channel: 'campfire' } })).toEqual({ text: 'hello', thread: 'one', channel: 'campfire', fixed: 'web' });
    expect(chatMutationInput(chat, 'hello', null)).toEqual({ text: 'hello', fixed: 'web' });
  });
  it('renders basic markdown while escaping HTML and unsafe link schemes', () => {
    const rendered = safeMarkdown('**Hello** <script>alert(1)</script> [safe](https://example.test) [bad](javascript:alert(1))');
    expect(rendered).toContain('<strong>Hello</strong>');
    expect(rendered).toContain('&lt;script&gt;');
    expect(rendered).toContain('href="https://example.test/"');
    expect(rendered).not.toContain('href="javascript:');
  });
  it('allows only safe chat URL schemes and local relative paths', () => {
    expect(safeChatUrl('https://example.test/path')).toBe('https://example.test/path');
    expect(safeChatUrl('/files/report.pdf')).toBe('/files/report.pdf');
    expect(safeChatUrl('mailto:help@example.test')).toBe('mailto:help@example.test');
    expect(safeChatUrl('javascript:alert(1)')).toBeNull();
    expect(safeChatUrl('//evil.example/path')).toBeNull();
  });
  it('validates chat navigation against visible page state declarations', () => {
    const pages = [{ id: 'activity-search', title: 'Activity search', blocks: [], state: {
      search: { type: 'text' as const, label: 'Search', default: '' },
      status: { type: 'select' as const, label: 'Status', default: '', options: [{ value: '', label: 'All' }, { value: 'complete', label: 'Complete' }] },
    } }];
    expect(validateChatNavigation(pages, 'activity-search', { search: 'hike', status: 'complete' })).toMatchObject({ pageId: 'activity-search' });
    expect(() => validateChatNavigation(pages, 'operations', {})).toThrow(/not available/);
    expect(() => validateChatNavigation(pages, 'activity-search', { status: 'admin' })).toThrow(/unavailable value/);
    expect(() => validateChatNavigation(pages, 'activity-search', { mutation: 'delete' })).toThrow(/invalid state/);
  });
});
