<script lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  let { content }: { content: unknown } = $props();
  const safe = $derived(DOMPurify.sanitize(marked.parse(typeof content === 'string' ? content : '', { async: false }), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'style', 'iframe', 'form', 'input', 'button'], FORBID_ATTR: ['style'],
  }));
</script>
<div class="markdown">{@html safe}</div>
