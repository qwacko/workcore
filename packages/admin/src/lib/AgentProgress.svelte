<script lang="ts">
  import type { Json } from '@workcore/core';
  import { readPath, text } from './data.js';
  import * as Card from './components/ui/card/index.js';
  import { Badge } from './components/ui/badge/index.js';
  let { value, status }: { value: Json; status?: Json } = $props();
</script>
<Card.Root aria-label="Agent progress" role="status" size="sm">
  <Card.Content class="flex flex-wrap items-center gap-2">
  <strong>{status === 'running' ? text(readPath(value, 'phase')) : text(status ?? readPath(value, 'phase'))}</strong>
  {#if (!status || status === 'completed') && readPath(value, 'completion.kind') === 'tool'}<span> via {text(readPath(value, 'completion.tool'))}</span>{/if}
  {#if readPath(value, 'mode') === 'demo'}<Badge variant="secondary">Offline demo</Badge>{/if}
  {#if readPath(value, 'completionMode') === 'tool-required'}<Badge variant="outline">Terminating tool required</Badge>{/if}
  {#if readPath(value, 'turn')}<span> · Turn {text(readPath(value, 'turn'))}{readPath(value, 'maxTurns') ? ` / ${readPath(value, 'maxTurns')}` : ''}</span>{/if}
  {#if readPath(value, 'model')}<div class="help">{text(readPath(value, 'profile'))} · {text(readPath(value, 'model.provider'))}/{text(readPath(value, 'model.model'))}</div>{/if}
  {#if readPath(value, 'tool')}<div class="help">Tool: {text(readPath(value, 'tool'))}</div>{/if}
  {#if readPath(value, 'usage')}<div class="help">Reported tokens: {text(readPath(value, 'usage.inputTokens'))} input · {text(readPath(value, 'usage.outputTokens'))} output · {text(readPath(value, 'usage.totalTokens'))} total · Backup attempts: {text(readPath(value, 'fallbackAttempts'))}</div>{/if}
  </Card.Content>
</Card.Root>
