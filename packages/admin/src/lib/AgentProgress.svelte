<script lang="ts">
  import type { Json } from '@workcore/core';
  import { readPath, text } from './data.js';
  let { value, status }: { value: Json; status?: Json } = $props();
</script>
<div class="notice" aria-label="Agent progress" role="status">
  <strong>{status === 'running' ? text(readPath(value, 'phase')) : text(status ?? readPath(value, 'phase'))}</strong>
  {#if (!status || status === 'completed') && readPath(value, 'completion.kind') === 'tool'}<span> via {text(readPath(value, 'completion.tool'))}</span>{/if}
  {#if readPath(value, 'mode') === 'demo'}<span class="badge">Offline demo</span>{/if}
  {#if readPath(value, 'completionMode') === 'tool-required'}<span class="badge">Terminating tool required</span>{/if}
  {#if readPath(value, 'turn')}<span> · Turn {text(readPath(value, 'turn'))}{readPath(value, 'maxTurns') ? ` / ${readPath(value, 'maxTurns')}` : ''}</span>{/if}
  {#if readPath(value, 'model')}<div class="help">{text(readPath(value, 'profile'))} · {text(readPath(value, 'model.provider'))}/{text(readPath(value, 'model.model'))}</div>{/if}
  {#if readPath(value, 'tool')}<div class="help">Tool: {text(readPath(value, 'tool'))}</div>{/if}
  {#if readPath(value, 'usage')}<div class="help">Reported tokens: {text(readPath(value, 'usage.inputTokens'))} input · {text(readPath(value, 'usage.outputTokens'))} output · {text(readPath(value, 'usage.totalTokens'))} total · Backup attempts: {text(readPath(value, 'fallbackAttempts'))}</div>{/if}
</div>
