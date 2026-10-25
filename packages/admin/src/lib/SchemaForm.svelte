<script lang="ts">
  import { untrack } from 'svelte';
  import type { Json, JsonSchema } from '@workcore/core';
  import Field from './Field.svelte';
  import { clone, defaults, setField, validation } from './data.js';
  let { schema, initial, locked = [], submitLabel = 'Execute', onsubmit, busy = false }: {
    schema: JsonSchema; initial?: Json; locked?: string[]; submitLabel?: string;
    onsubmit: (value: Json) => Promise<void> | void; busy?: boolean;
  } = $props();
  const idPrefix = $props.id();
  let value = $state<Json>(untrack(() => clone(initial ?? defaults(schema))));
  let advanced = $state(false);
  let jsonText = $state(untrack(() => JSON.stringify(value, null, 2)));
  let errors = $state<Record<string, string>>({});
  let submitting = $state(false);
  let failed = $state('');
  const object = $derived(schema.type === 'object' || !!schema.properties);
  async function submit(event: SubmitEvent) {
    event.preventDefault(); failed = '';
    if (!(event.currentTarget as HTMLFormElement).reportValidity()) return;
    try {
      let input = advanced || !object ? JSON.parse(jsonText) as Json : value;
      // Bound/fixed values cannot be changed through the advanced editor.
      for (const key of locked) input = setField(input, key, (initial as Record<string, Json>)?.[key]);
      errors = validation(schema, input);
      if (Object.keys(errors).length) return;
      submitting = true;
      await onsubmit(input);
    } catch (error) { failed = error instanceof Error ? error.message : 'Operation failed'; }
    finally { submitting = false; }
  }
</script>

<form onsubmit={submit} novalidate>
  {#if object}
    <div class="form-fields">
      {#if !advanced}
        {#each Object.entries(schema.properties ?? {}) as [name, child]}
          {#if !locked.includes(name)}
            <Field schema={child} {name} {idPrefix} value={(value as Record<string, Json>)?.[name]} onchange={next => { value = setField(value, name, next); }} required={schema.required?.includes(name)} {errors} disabled={busy || submitting} />
          {/if}
        {/each}
      {/if}
    </div>
    <button type="button" class="text-button small" onclick={() => { advanced = !advanced; jsonText = JSON.stringify(value, null, 2); errors = {}; }}>{advanced ? 'Use form fields' : 'Advanced JSON'}</button>
  {/if}
  {#if advanced || !object}
    <label class="field">Operation input JSON<textarea class="code" bind:value={jsonText} disabled={busy || submitting}></textarea></label>
    {#each Object.entries(errors) as [path, message]}<p class="error">{path || 'Input'}: {message}</p>{/each}
  {/if}
  {#if failed}<p class="error" role="alert">{failed}</p>{/if}
  {#if !advanced && Object.keys(errors).length}<div class="error" role="alert"><strong>Please check the form.</strong><ul>{#each Object.entries(errors) as [path, message]}<li>{path || 'Input'}: {message}</li>{/each}</ul></div>{/if}
  <div class="form-footer"><button class="primary" type="submit" disabled={busy || submitting}>{submitting ? 'Working…' : submitLabel}</button></div>
</form>
