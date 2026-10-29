<script lang="ts">
  import { getContext } from 'svelte';
  import type { Json, JsonSchema } from '@workcore/core';
  import Field from './Field.svelte';
  import { label, resolveSchema, setField } from './data.js';
  import { rendererRegistryKey, type RendererRegistryContext } from './renderer-context.js';
  import RelationshipLookupField from './RelationshipLookupField.svelte';
  let { schema, name, value, onchange, required = false, path = name, errors = {}, disabled = false, idPrefix = 'field' }: {
    schema: JsonSchema; name: string; value: any; onchange: (value: any) => void;
    required?: boolean; path?: string; errors?: Record<string, string>; disabled?: boolean; idPrefix?: string;
  } = $props();
  const getRenderers = getContext<RendererRegistryContext>(rendererRegistryKey);
  const renderers = $derived(getRenderers?.() ?? {});
  let jsonText = $state('');
  let jsonError = $state('');
  const resolved = $derived(resolveSchema(schema));
  const hints = $derived(schema['x-workcore'] ?? {});
  const relationship = $derived(hints.relationship);
  const title = $derived(schema.title ?? label(name));
  const locked = $derived(disabled || hints.readOnly === true);
  const fieldId = $derived(`${idPrefix}-${path}`);
  const itemSchema = $derived(resolved.items ? resolveSchema(resolved.items) : undefined);
  const repeatable = $derived(resolved.type === 'array' && !!itemSchema && typeof itemSchema.type === 'string' && ['string', 'number', 'integer', 'boolean'].includes(itemSchema.type));
  const minItems = $derived(typeof resolved.minItems === 'number' ? resolved.minItems : undefined);
  const maxItems = $derived(typeof resolved.maxItems === 'number' ? resolved.maxItems : undefined);
  const nullable = $derived((schema.anyOf ?? schema.oneOf ?? []).some(part => part.type === 'null') || (Array.isArray(schema.type) && schema.type.includes('null')));
  function restoreValue() {
    if (resolved.enum?.length) return resolved.enum[0];
    if (resolved.type === 'boolean') return false;
    if (resolved.type === 'number' || resolved.type === 'integer') return resolved.minimum ?? 0;
    return '';
  }
  const complex = $derived(hints.control === 'json' || resolved.type === 'array' && !repeatable || !!resolved.anyOf || !!resolved.oneOf || !resolved.type && !resolved.properties && !resolved.enum);
  $effect(() => { jsonText = JSON.stringify(value ?? null, null, 2); });
</script>

{#if !hints.hidden}
  {@const CustomField = hints.renderer ? renderers?.[hints.renderer] : undefined}
  {#if CustomField}
    <div class="field custom-field"><span class="field-label">{title}{required ? ' *' : ''}</span><CustomField value={value ?? null} schema={schema} name={name} label={title} path={path} required={required} disabled={locked} error={errors[path]} onchange={onchange} />{#if schema.description}<span class="help">{schema.description}</span>{/if}{#if errors[path]}<span class="error" role="alert">{errors[path]}</span>{/if}</div>
  {:else if resolved.type === 'object' || resolved.properties}
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
      {#if hints.renderer}<span class="help" role="status">Custom field renderer “{hints.renderer}” is not registered; using the standard control.</span>{/if}
      {#if nullable}<label class="check"><input type="checkbox" checked={value === null} disabled={locked} onchange={event => onchange(event.currentTarget.checked ? null : restoreValue())} /> <span>No value</span></label>{/if}
      {#if relationship}
        <RelationshipLookupField config={relationship} {title} fieldId={fieldId} value={value as Json | undefined} onchange={next => onchange(next)} disabled={locked} error={errors[path]} />
      {:else if repeatable && itemSchema}
        <div class="repeatable-fields">
          {#each (Array.isArray(value) ? value : []) as item, index (index)}
            <div class="repeatable-item"><Field schema={resolved.items!} name={`${name} ${index + 1}`} path={`${path}.${index}`} value={item} onchange={next => onchange((Array.isArray(value) ? value : []).map((current, currentIndex) => currentIndex === index ? next : current))} required errors={errors} {idPrefix} disabled={locked} /><button type="button" class="text-button small" disabled={locked || (minItems !== undefined && value.length <= minItems)} aria-label={`Remove ${title} ${index + 1}`} onclick={() => onchange((Array.isArray(value) ? value : []).filter((_, currentIndex) => currentIndex !== index))}>Remove</button></div>
          {/each}
          <button type="button" class="text-button small" disabled={locked || (maxItems !== undefined && Array.isArray(value) && value.length >= maxItems)} onclick={() => onchange([...(Array.isArray(value) ? value : []), itemSchema.enum?.[0] ?? (itemSchema.type === 'boolean' ? false : itemSchema.type === 'number' || itemSchema.type === 'integer' ? itemSchema.minimum ?? 0 : '')])}>Add {title.toLowerCase()}</button>
        </div>
      {:else if resolved.enum || resolved.const !== undefined}
        <select id={fieldId} disabled={locked} value={JSON.stringify(value)} onchange={event => onchange(event.currentTarget.value === '' ? undefined : JSON.parse(event.currentTarget.value))} aria-invalid={!!errors[path]}>
          {#if !required}<option value="">Not set</option>{/if}
          {#each resolved.enum ?? [resolved.const] as option}<option value={JSON.stringify(option)}>{hints.enumLabels?.[String(option)] ?? String(option)}</option>{/each}
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
      {:else if hints.control === 'date' || hints.control === 'datetime-local'}
        <input id={fieldId} type={hints.control} value={value ?? ''} disabled={locked || value === null} oninput={event => onchange(event.currentTarget.value === '' && nullable ? null : event.currentTarget.value)} aria-invalid={!!errors[path]} />
      {:else}
        <input id={fieldId} type={['email', 'url', 'password'].includes(hints.control ?? '') ? hints.control : 'text'} value={value ?? ''} disabled={locked || value === null} placeholder={hints.placeholder ?? schema.examples?.[0]?.toString() ?? ''} minlength={resolved.minLength} maxlength={resolved.maxLength} oninput={event => onchange(!required && !nullable && event.currentTarget.value === '' ? undefined : event.currentTarget.value)} aria-invalid={!!errors[path]} />
      {/if}
      {#if schema.description}<span class="help">{schema.description}</span>{/if}
      {#if errors[path]}<span class="error" role="alert">{errors[path]}</span>{/if}
    </div>
  {/if}
{/if}
