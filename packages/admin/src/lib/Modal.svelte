<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Dialog from './components/ui/dialog/index.js';
  import { Button } from './components/ui/button/index.js';
  let { title, children, onclose }: { title: string; children: Snippet; onclose: () => void } = $props();
</script>
<Dialog.Root open onOpenChange={value => { if (!value) onclose(); }}>
  <Dialog.Portal><Dialog.Overlay /><Dialog.Content>
    <Dialog.Header><Dialog.Title>{title}</Dialog.Title></Dialog.Header>
    {@render children()}
    <Dialog.Footer><Button variant="outline" onclick={onclose}>Close</Button></Dialog.Footer>
  </Dialog.Content></Dialog.Portal>
</Dialog.Root>
