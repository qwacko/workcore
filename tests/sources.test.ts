import { describe, expect, it, vi } from 'vitest';
import { createSources } from '../packages/client/src/sources.js';
import type { RuntimeClient } from '../packages/client/src/index.js';

describe('shared reactive sources', () => {
  it('shares equivalent view inputs and releases the underlying subscription once', () => {
    const unsubscribe = vi.fn();
    const client = { subscribe: vi.fn(() => ({ unsubscribe })) } as unknown as RuntimeClient;
    const sources = createSources(client);
    const a = sources.watch({ kind: 'view', name: 'tasks' }, { project: 'one', status: 'open' }, () => {});
    const b = sources.watch({ kind: 'view', name: 'tasks' }, { status: 'open', project: 'one' }, () => {});
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    a(); expect(unsubscribe).not.toHaveBeenCalled();
    b(); expect(unsubscribe).toHaveBeenCalledTimes(1);
    sources.close();
  });
  it('refreshes a query again when a mutation invalidates it during an in-flight request', async () => {
    let resolve: (value: unknown) => void = () => {};
    const pending = new Promise(complete => resolve = complete);
    const query = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ data: ['new'], revision: 3 });
    const sources = createSources({ query } as unknown as RuntimeClient);
    const listener = vi.fn();
    const stop = sources.watch({ kind: 'query', name: 'tasks' }, {}, listener);
    sources.refresh();
    resolve({ data: ['old'], revision: 2 });
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith({ status: 'live', data: ['new'], revision: 3 }));
    stop(); sources.close();
  });
  it('does not deliver a late response after a source is released', async () => {
    let resolve: (value: unknown) => void = () => {};
    const query = vi.fn(() => new Promise(complete => resolve = complete));
    const sources = createSources({ query } as unknown as RuntimeClient);
    const listener = vi.fn();
    const stop = sources.watch({ kind: 'query', name: 'tasks' }, {}, listener);
    stop(); resolve({ data: ['late'], revision: 8 });
    await Promise.resolve(); await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    sources.close();
  });
});
