<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';
  let { text }: { text: string } = $props();
  const html = $derived(
    DOMPurify.sanitize(marked.parse(text, { async: false }) as string, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['img', 'style', 'iframe', 'form', 'input', 'button'],
      FORBID_ATTR: ['style'],
    }),
  );
</script>

<div class="prose-chat">{@html html}</div>
