<script lang="ts">
  import StatusBadge from './StatusBadge.svelte';
  let { value }: { value: unknown } = $props();
  const complete = $derived(value === true);
</script>

<span aria-label={complete ? 'Complete' : 'Open'}><StatusBadge tone={complete ? 'success' : 'neutral'}>{complete ? 'Complete' : 'Open'}</StatusBadge></span>
