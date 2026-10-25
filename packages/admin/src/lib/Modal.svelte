<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, children, onclose }: { title: string; children: Snippet; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  $effect(() => { dialog.showModal(); return () => dialog.close(); });
</script>
<dialog bind:this={dialog} onclose={onclose} aria-label={title}>
  <div class="dialog-header"><h2>{title}</h2><button class="icon-button" aria-label="Close dialog" onclick={() => dialog.close()}>✕</button></div>
  {@render children()}
</dialog>
