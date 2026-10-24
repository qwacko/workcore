import { describe, expect, it, vi } from 'vitest';
import { createRedisEvents } from './redis/index.js';

const scope = { applicationId: 'app', workspaceId: 'one' };
const event = { ...scope, id: 'event', type: 'workspace.invalidated', actorId: 'alice', correlationId: 'correlation', createdAt: '2026-01-01T00:00:00Z' };

describe('Redis subscription lifecycle', () => {
  it('isolates malformed/wrong-scope messages and failing consumer callbacks', () => {
    let receive!: (message: string) => void;
    const subscriber = { subscribe: vi.fn((_channel: string, listener: typeof receive) => { receive = listener; }), unsubscribe: vi.fn() };
    const events = createRedisEvents({ publisher: { publish() {} }, subscriber });
    const received = vi.fn();
    const stops = [events.subscribe(scope, () => { throw new Error('consumer failed'); }), events.subscribe(scope, received)];
    receive('not JSON');
    receive(JSON.stringify({ ...event, workspaceId: 'other' }));
    expect(received).not.toHaveBeenCalled();
    receive(JSON.stringify(event));
    expect(received).toHaveBeenCalledExactlyOnceWith(event);
    stops.forEach((stop) => stop());
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('makes disposal idempotent even when a listener is reused in a new subscription', () => {
    const subscriber = { subscribe: vi.fn(), unsubscribe: vi.fn() };
    const events = createRedisEvents({ publisher: { publish() {} }, subscriber });
    const listener = vi.fn();
    const first = events.subscribe(scope, listener);
    first();
    const second = events.subscribe(scope, listener);
    first();
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    second();
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('does not let an old rejected subscription remove its replacement', async () => {
    let reject!: (error: Error) => void;
    const initial = new Promise<void>((_resolve, fail) => { reject = fail; });
    const subscriber = { subscribe: vi.fn().mockReturnValueOnce(initial), unsubscribe: vi.fn() };
    const events = createRedisEvents({ publisher: { publish() {} }, subscriber });
    const first = events.subscribe(scope, vi.fn());
    first();
    const second = events.subscribe(scope, vi.fn());
    reject(new Error('old connection failed'));
    await Promise.resolve();
    second();
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(2);
  });
});
