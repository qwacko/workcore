<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { LiveState } from '@workcore/client';
  let { state, label = 'Loading result', children }: {
    state: LiveState<T>;
    label?: string;
    children: Snippet<[T]>;
  } = $props();
</script>

{#if state.data !== undefined}
  {@render children(state.data)}
  {#if state.status === 'reconnecting'}<p class="source-status" role="status">Reconnecting · showing the last available result</p>{/if}
{:else if state.status === 'error'}
  <div class="notice error" role="alert"><strong>{state.error?.code ?? 'REQUEST_FAILED'}</strong><p>{state.error?.message ?? 'The result is unavailable.'}</p></div>
{:else}
  <div class="skeleton" aria-label={label}></div>
  {#if state.status === 'reconnecting'}<p class="source-status" role="status">Reconnecting to the data source…</p>{/if}
{/if}
