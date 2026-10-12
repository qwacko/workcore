import type { EventAdapter, Scope, WorkcoreEvent } from '@workcore/core';

/** Structural shape implemented by Redis clients such as node-redis and ioredis. Use dedicated pub/sub connections. */
export interface RedisPublisher { publish(channel: string, message: string): Promise<unknown> | unknown }
export interface RedisSubscriber {
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown> | unknown;
  unsubscribe(channel: string, listener?: (message: string) => void): Promise<unknown> | unknown;
}

/** Redis pub/sub events are transient; clients must retain Workcore's periodic refresh recovery. */
export function createRedisEvents(options: { publisher: RedisPublisher; subscriber: RedisSubscriber; prefix?: string }): EventAdapter {
  const prefix = options.prefix ?? 'workcore:events';
  const channels = new Map<string, { listeners: Set<(event: WorkcoreEvent) => void>; receive: (message: string) => void }>();
  const channelFor = (scope: Scope) => `${prefix}:${Buffer.from(JSON.stringify([scope.applicationId, scope.workspaceId])).toString('base64url')}`;
  return {
    publish: async (event) => { await options.publisher.publish(channelFor(event), JSON.stringify(event)); },
    subscribe: (scope, listener) => {
      const channel = channelFor(scope);
      let entry = channels.get(channel);
      if (!entry) {
        const listeners = new Set<(event: WorkcoreEvent) => void>();
        const receive = (message: string) => {
          let event: WorkcoreEvent;
          try { event = JSON.parse(message) as WorkcoreEvent; }
          catch { return; }
          if (!event || event.applicationId !== scope.applicationId || event.workspaceId !== scope.workspaceId || typeof event.type !== 'string') return;
          for (const callback of listeners) {
            try { callback(event); }
            catch { /* A consumer callback must not interrupt delivery to sibling subscribers. */ }
          }
        };
        entry = { listeners, receive };
        channels.set(channel, entry);
        void Promise.resolve(options.subscriber.subscribe(channel, receive)).catch(() => channels.delete(channel));
      }
      entry.listeners.add(listener);
      return () => {
        const current = channels.get(channel);
        if (!current) return;
        current.listeners.delete(listener);
        if (!current.listeners.size) {
          channels.delete(channel);
          void Promise.resolve(options.subscriber.unsubscribe(channel, current.receive)).catch(() => undefined);
        }
      };
    },
  };
}
