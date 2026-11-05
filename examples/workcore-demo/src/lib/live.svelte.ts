import type { LiveState, Subscription } from '@workcore/client';

/** Small application helper: ordinary typed subscriptions with Svelte lifecycle cleanup. */
export function useLive<T>(
  subscribe: (listener: (state: LiveState<T>) => void) => Subscription<T> | undefined,
  options: { retainWhenInactive?: boolean } = {},
) {
  let state = $state<LiveState<T>>({ status: 'loading', revision: 0 });
  $effect(() => {
    // The client synchronously supplies the shared snapshot, or initial loading state.
    const subscription = subscribe((value) => (state = value));
    if (!subscription && !options.retainWhenInactive) state = { status: 'loading', revision: 0 };
    return () => subscription?.unsubscribe();
  });
  return {
    get state() {
      return state;
    },
  };
}
