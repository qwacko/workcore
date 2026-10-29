import type { LiveState } from '@workcore/client';

export type ResourceLoader<T> = {
  readonly state: LiveState<T>;
  readonly data: T | undefined;
  refresh(): void;
};

/** Promise-backed counterpart to useSource for endpoints without a subscription transport. */
export function useAsyncResource<T, TKey>(getKey: () => TKey | null, load: (key: TKey) => Promise<T>): ResourceLoader<T> {
  let state = $state<LiveState<T>>({ status: 'loading', revision: 0 });
  let refreshKey = $state(0);
  let generation = 0;
  let revision = 0;

  $effect(() => {
    const key = getKey();
    refreshKey;
    if (key === null) { state = { status: 'loading', revision }; return; }
    const current = ++generation;
    state = { status: 'loading', revision };
    void load(key).then(data => {
      if (current === generation) state = { status: 'live', data, revision: ++revision };
    }).catch(error => {
      if (current === generation) state = { status: 'error', revision, error: { code: 'RESOURCE_LOAD_FAILED', message: error instanceof Error ? error.message : 'Could not load resource' } };
    });
    return () => { generation++; };
  });

  return {
    get state() { return state; },
    get data() { return state.data; },
    refresh() { refreshKey++; },
  };
}

export type TaskState = { status: 'idle' | 'pending' | 'success' | 'error'; error?: string };
export type Task<TArgs extends unknown[], TResult> = {
  readonly state: TaskState;
  execute(...args: TArgs): Promise<TResult>;
  reset(): void;
};

/** Standard pending/success/error lifecycle for commands and file transfers. */
export function useTask<TArgs extends unknown[], TResult>(run: (...args: TArgs) => Promise<TResult>): Task<TArgs, TResult> {
  let state = $state<TaskState>({ status: 'idle' });
  let generation = 0;
  return {
    get state() { return state; },
    async execute(...args: TArgs) {
      const current = ++generation;
      state = { status: 'pending' };
      try { const result = await run(...args); if (current === generation) state = { status: 'success' }; return result; }
      catch (error) { if (current === generation) state = { status: 'error', error: error instanceof Error ? error.message : 'Operation failed' }; throw error; }
    },
    reset() { generation++; state = { status: 'idle' }; },
  };
}
