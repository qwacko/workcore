<script lang="ts">
  import type { JsonSchema } from '@workcore/core';
  import Field from './Field.svelte';
  import { label, resolveSchema, setField } from './data.js';
  let { schema, name, value, onchange, required = false, path = name, errors = {}, disabled = false, idPrefix = 'field' }: {
    schema: JsonSchema; name: string; value: any; onchange: (value: any) => void;
    required?: boolean; path?: string; errors?: Record<string, string>; disabled?: boolean; idPrefix?: string;
  } = $props();
  let jsonText = $state('');
  let jsonError = $state('');
  const resolved = $derived(resolveSchema(schema));
  const hints = $derived(schema['x-workcore'] ?? {});
  const title = $derived(schema.title ?? label(name));
  const locked = $derived(disabled || hints.readOnly === true);
  const fieldId = $derived(`${idPrefix}-${path}`);
  const complex = $derived(hints.control === 'json' || resolved.type === 'array' || !!resolved.anyOf || !!resolved.oneOf || !resolved.type && !resolved.properties && !resolved.enum);
  $effect(() => { jsonText = JSON.stringify(value ?? null, null, 2); });
</script>

{#if !hints.hidden}
  {#if resolved.type === 'object' || resolved.properties}
    <fieldset class="nested" disabled={locked}>
      <legend>{title}{required ? ' *' : ''}</legend>
      {#if schema.description}<p class="help">{schema.description}</p>{/if}
      {#each Object.entries(resolved.properties ?? {}) as [key, child]}
        <Field schema={child} name={key} path={`${path}.${key}`} value={value?.[key]} onchange={next => onchange(setField(value, key, next))} required={resolved.required?.includes(key)} {errors} {idPrefix} disabled={locked} />
      {/each}
    </fieldset>
  {:else}
    <div class="field">
      <label for={fieldId}>{title}{required ? ' *' : ''}</label>
      {#if resolved.enum || resolved.const !== undefined}
        <select id={fieldId} disabled={locked} value={JSON.stringify(value)} onchange={event => onchange(event.currentTarget.value === '' ? undefined : JSON.parse(event.currentTarget.value))} aria-invalid={!!errors[path]}>
          {#if !required}<option value="">Not set</option>{/if}
          {#each resolved.enum ?? [resolved.const] as option}<option value={JSON.stringify(option)}>{String(option)}</option>{/each}
        </select>
      {:else if resolved.type === 'boolean'}
        <label class="check"><input id={fieldId} type="checkbox" checked={value === true} disabled={locked} onchange={event => onchange(event.currentTarget.checked)} /> <span>{value ? 'Yes' : 'No'}</span></label>
      {:else if complex}
        <textarea id={fieldId} class="code" value={jsonText} disabled={locked} oninput={event => {
          jsonText = event.currentTarget.value;
          try { const parsed = JSON.parse(jsonText); jsonError = ''; event.currentTarget.setCustomValidity(''); onchange(parsed); } catch { jsonError = 'Enter valid JSON'; event.currentTarget.setCustomValidity(jsonError); }
        }} aria-invalid={!!errors[path] || !!jsonError}></textarea>
        {#if jsonError}<span class="error">{jsonError}</span>{/if}
      {:else if hints.control === 'textarea'}
        <textarea id={fieldId} value={value ?? ''} disabled={locked} placeholder={hints.placeholder ?? ''} maxlength={resolved.maxLength} oninput={event => onchange(!required && event.currentTarget.value === '' ? undefined : event.currentTarget.value)} aria-invalid={!!errors[path]}></textarea>
      {:else if resolved.type === 'number' || resolved.type === 'integer'}
        <input id={fieldId} type="number" value={value} disabled={locked} min={resolved.minimum} max={resolved.maximum} step={resolved.type === 'integer' ? 1 : 'any'} oninput={event => onchange(event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value))} aria-invalid={!!errors[path]} />
      {:else}
        <input id={fieldId} type={['email', 'url', 'password'].includes(hints.control ?? '') ? hints.control : 'text'} value={value ?? ''} disabled={locked} placeholder={hints.placeholder ?? schema.examples?.[0]?.toString() ?? ''} minlength={resolved.minLength} maxlength={resolved.maxLength} oninput={event => onchange(!required && event.currentTarget.value === '' ? undefined : event.currentTarget.value)} aria-invalid={!!errors[path]} />
      {/if}
      {#if schema.description}<span class="help">{schema.description}</span>{/if}
      {#if errors[path]}<span class="error" role="alert">{errors[path]}</span>{/if}
    </div>
  {/if}
{/if}
