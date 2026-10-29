<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  let { block, data }: { block: Extract<ManifestBlock, { kind: 'json' }>; data: Json } = $props();
</script>
<pre aria-label={block.title ?? 'JSON result'}>{JSON.stringify(data, null, 2)}</pre>
