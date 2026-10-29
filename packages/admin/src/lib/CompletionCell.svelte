<script lang="ts">
  let { value }: { value: unknown } = $props();
  const complete = $derived(value === true);
</script>

<span class="badge" data-tone={complete ? 'success' : 'neutral'} aria-label={complete ? 'Complete' : 'Open'}>{complete ? 'Complete' : 'Open'}</span>
