<script lang="ts">
  import type { OperationViews, WorkcoreManifest } from '@workcore/client';
  import OperationInput from './OperationInput.svelte';
  import { hydrateRuntimeTypes, parseEditableJson } from './rich-input.js';

  let { operation, variant, title, contextKey, onSubmit } = $props<{
    operation: WorkcoreManifest['operations'][number] & { kind: 'mutation' };
    variant?: OperationViews['variants'][string] | undefined;
    title?: string | undefined;
    contextKey: string;
    onSubmit: (input: Record<string, unknown>) => Promise<void>;
  }>();

  let inputText = $state('');
  let submitting = $state(false);
  let error = $state('');
  let notice = $state('');
  let activeContext = '';

  function defaultValue(schema: Record<string, unknown>): unknown {
    if (Object.hasOwn(schema, 'default')) return schema.default;
    if (schema.type === 'object') {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (schema.required as string[] | undefined) ?? [];
      return Object.fromEntries(Object.entries(properties ?? {}).filter(([key, child]) => required.includes(key) || Object.hasOwn(child, 'default')).map(([key, child]) => [key, defaultValue(child)]));
    }
    if (schema.type === 'array') return [];
    if (Array.isArray(schema.enum)) return schema.enum[0];
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return 0;
    return '';
  }

  $effect(() => {
    const operationName = operation.name;
    const currentKey = contextKey;
    if (activeContext !== `${currentKey}:${operationName}`) {
      activeContext = `${currentKey}:${operationName}`;
      inputText = JSON.stringify(defaultValue(operation.input), null, 2);
      error = '';
      notice = '';
    }
  });

  async function submit() {
    if (submitting) return;
    error = '';
    notice = '';
    try {
      const parsed = parseEditableJson(inputText || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Mutation input must be a JSON object.');
      const input = hydrateRuntimeTypes(parsed, operation.input) as Record<string, unknown>;
      submitting = true;
      await onSubmit(input);
      notice = 'Mutation completed.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      submitting = false;
    }
  }
</script>

<form class="inline-mutation-form" aria-label={title ?? operation.name} onsubmit={(event) => { event.preventDefault(); void submit(); }}>
  <header><div><h3>{title ?? variant?.title ?? operation.name}</h3><p>{variant?.subtitle ?? 'Validated mutation form'}</p></div></header>
  <OperationInput {operation} {variant} {inputText} onInputChange={(value) => { inputText = value; error = ''; notice = ''; }} />
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if notice}<p class="form-notice" role="status">{notice}</p>{/if}
  <button class="primary" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit mutation'}</button>
</form>

<style>
  .inline-mutation-form { display: grid; gap: 12px; }
  header h3 { margin: 0; }
  header p { margin: 4px 0 0; color: var(--muted, #63716a); }
  .form-error { color: var(--danger, #a12622); }
  .form-notice { color: var(--success, #276348); }
</style>
