export type EmbedBudget = {
  readonly count: number;
  reserve(token: symbol): boolean;
  release(token: symbol): void;
  subscribe(listener: () => void): () => void;
};
export type EmbedContext = { ancestry: string[]; budget: EmbedBudget; instanceId: string; memoryOnly: boolean; embedded: boolean };
export const embedContextKey = Symbol('workcore-embed-context');

export function createEmbedBudget(limit = 20): EmbedBudget {
  let activeCount = 0;
  const active = new Set<symbol>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    get count() { return activeCount; },
    reserve(token) {
      if (active.has(token)) return true;
      if (activeCount >= limit) return false;
      active.add(token);
      activeCount++;
      notify();
      return true;
    },
    release(token) {
      if (!active.delete(token)) return;
      activeCount--;
      notify();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
