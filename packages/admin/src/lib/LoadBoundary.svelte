<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { LiveState } from '@workcore/client';
  import Alert from './Alert.svelte';
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
  <Alert variant="destructive" title={state.error?.code ?? 'REQUEST_FAILED'}><p>{state.error?.message ?? 'The result is unavailable.'}</p></Alert>
{:else}
  <div class="skeleton" aria-label={label}></div>
  {#if state.status === 'reconnecting'}<p class="source-status" role="status">Reconnecting to the data source…</p>{/if}
{/if}
