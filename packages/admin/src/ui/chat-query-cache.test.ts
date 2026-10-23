import { describe, expect, it } from 'vitest';
import { clearChatQueryViewCache, loadCachedChatQueryView } from './chat-query-cache.js';

describe('chat query-view cache', () => {
  it('shares in-flight and completed requests until invalidated', async () => {
    clearChatQueryViewCache();
    let calls = 0;
    const load = async () => ({ value: ++calls });
    const first = loadCachedChatQueryView('actor-a', 'scope/query/input', load);
    const second = loadCachedChatQueryView('actor-a', 'scope/query/input', load);
    expect(await first).toEqual({ value: 1 });
    expect(await second).toEqual({ value: 1 });
    expect(calls).toBe(1);
    expect(await loadCachedChatQueryView('actor-b', 'scope/query/input', load)).toEqual({ value: 2 });
    clearChatQueryViewCache('actor-a');
    expect(await loadCachedChatQueryView('actor-a', 'scope/query/input', load)).toEqual({ value: 3 });
  });

  it('does not retain rejected requests', async () => {
    clearChatQueryViewCache();
    await expect(loadCachedChatQueryView('namespace', 'failed', async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    expect(await loadCachedChatQueryView('namespace', 'failed', async () => 'ok')).toBe('ok');
  });
});
