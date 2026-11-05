<script lang="ts">
  import { Input } from './components/ui/input/index.js';
  let { value, disabled = false, onchange }: { value: unknown; disabled?: boolean; onchange(value: unknown): void } = $props();
</script>

<Input type="text" aria-label="Task title" value={typeof value === 'string' ? value : ''} {disabled} maxlength={200} placeholder="A short description of the work." oninput={event => onchange(event.currentTarget.value)} />
