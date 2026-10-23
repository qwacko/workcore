import { describe, expect, it } from 'vitest';
import { QuerySourceController } from './query-source.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('QuerySourceController', () => {
  it('keeps prior results for request failures but clears them when access is forbidden', async () => {
    const source = new QuerySourceController<{ rows: string[] }>();
    await expect(source.run(async () => ({ rows: ['first'] }))).resolves.toBe(true);
    source.invalidate();
    expect(source.snapshot().stale).toBe(true);
    await expect(source.run(async () => { throw new Error('Temporary failure'); })).resolves.toBe(false);
    expect(source.snapshot()).toMatchObject({ status: 'error', hasResult: true, result: { rows: ['first'] }, error: { kind: 'request' } });

    source.invalidate();
    const pending = deferred<{ rows: string[] }>();
    const refresh = source.run(() => pending.promise);
    expect(source.snapshot()).toMatchObject({ status: 'refreshing', hasResult: true, result: { rows: ['first'] } });
    pending.reject(Object.assign(new Error('Access denied'), { code: 'FORBIDDEN' }));
    await expect(refresh).resolves.toBe(false);
    expect(source.snapshot()).toEqual({ status: 'error', hasResult: false, stale: false, error: { kind: 'forbidden', message: 'Access denied' } });

    await expect(source.run(async () => ({ rows: ['private-again'] }))).resolves.toBe(true);
    source.setError(Object.assign(new Error('Session expired'), { code: 'UNAUTHENTICATED' }));
    expect(source.snapshot()).toEqual({ status: 'error', hasResult: false, stale: false, error: { kind: 'forbidden', message: 'Session expired' } });
  });

  it('ignores out-of-order responses and context-invalid results', async () => {
    const source = new QuerySourceController<string>();
    const older = deferred<string>();
    const newer = deferred<string>();
    const first = source.run(() => older.promise);
    const second = source.run(() => newer.promise);
    newer.resolve('new');
    await expect(second).resolves.toBe(true);
    older.resolve('old');
    await expect(first).resolves.toBe(false);
    expect(source.snapshot()).toMatchObject({ status: 'ready', result: 'new' });

    let current = true;
    const stale = source.run(async () => 'stale', () => current);
    current = false;
    await expect(stale).resolves.toBe(false);
    expect(source.snapshot()).toEqual({ status: 'idle', hasResult: false, stale: false, error: null });
  });

  it('invalidates pending requests and clears protected data on disposal', async () => {
    const source = new QuerySourceController<string>();
    const pending = deferred<string>();
    const request = source.run(() => pending.promise);
    source.dispose();
    pending.resolve('private');
    await expect(request).resolves.toBe(false);
    expect(source.snapshot()).toEqual({ status: 'idle', hasResult: false, stale: false, error: null });
  });
});
