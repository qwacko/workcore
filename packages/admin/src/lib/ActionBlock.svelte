<script lang="ts">
  import type { ManifestAction, ManifestBlock } from "@workcore/core";
  import ActionForm from "./ActionForm.svelte";
  import Modal from "./Modal.svelte";
  import { Button } from './components/ui/button/index.js';
  let {
    block,
    action = block?.action,
  }: {
    block?: Extract<ManifestBlock, { kind: "button" }>;
    action?: ManifestAction;
  } = $props();
  let open = $state(false);
  const label = $derived(action?.label ?? block?.title ?? "Open action");
  const variant = $derived(block?.variant ?? "primary");
</script>

{#if action}
  <Button
    variant={variant === 'danger' ? 'destructive' : variant === 'secondary' ? 'outline' : 'default'}
    aria-haspopup="dialog"
    onclick={() => (open = true)}>{label}</Button
  >
  {#if open}<Modal title={action.label} onclose={() => (open = false)}
      ><ActionForm {action} ondone={() => (open = false)} /></Modal
    >{/if}
{/if}
