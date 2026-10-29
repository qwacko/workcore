<script lang="ts">
  import '../lib/style.css';
  let { children } = $props();
</script>
<svelte:head><link rel="icon" type="image/svg+xml" href="/admin/favicon.svg" /></svelte:head>
{@render children()}
