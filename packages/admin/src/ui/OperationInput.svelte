<script lang="ts">
  import type { UiMetadata, WorkcoreManifest } from '@workcore/client';
  import { editableJson, parseEditableJson } from './rich-input.js';

  let { operation, variant, inputText, onInputChange } = $props<{
    operation: WorkcoreManifest['operations'][number];
    variant?: UiMetadata['variants'][string] | undefined;
    inputText: string;
    onInputChange: (value: string) => void;
  }>();

  function currentInput() {
    try { return parseEditableJson(inputText || '{}') as Record<string, unknown>; } catch { return {}; }
  }
  function setField(key: string, value: unknown) {
    try { const parsed = currentInput(); parsed[key] = value; onInputChange(editableJson(parsed)); }
    catch { onInputChange(JSON.stringify({ [key]: value }, null, 2)); }
  }
  function clearField(key: string) {
    const input = currentInput();
    delete input[key];
    onInputChange(editableJson(input));
  }
  function enumValue(schema: Record<string, unknown>, value: string) {
    return (schema.enum as unknown[] | undefined)?.find((candidate) => String(candidate) === value);
  }
  function basicFields(properties: Record<string, Record<string, unknown>>) {
    return Object.values(properties).every((schema) => ['string', 'number', 'integer', 'boolean'].includes(String(schema.type)) || Array.isArray(schema.enum));
  }
  function editableFieldValue(value: unknown) { return value instanceof Date ? value.toISOString() : String(value ?? ''); }
</script>

{#if operation.kind !== 'query' || operation.input.properties}
  {@const properties = operation.input.properties as Record<string, Record<string, unknown>> | undefined}
  {#if (variant?.renderer === 'form' || variant?.renderer === 'table') && properties && Object.keys(properties).length > 0 && basicFields(properties)}
    <div class="generated-form">
      {#each Object.entries(properties) as [key, schema]}
        {@const value = currentInput()[key]}
        {@const required = ((operation.input.required as string[] | undefined) ?? []).includes(key)}
        <label class="field-label">{key}<span>{required ? 'Required' : 'Optional'}</span>
          {#if Array.isArray(schema.enum)}
            <select value={value === undefined ? (required ? String(schema.enum[0]) : '') : String(value)} onchange={(event) => { if (event.currentTarget.value) setField(key, enumValue(schema, event.currentTarget.value)); else clearField(key); }}>
              {#if !required}<option value="">Any</option>{/if}
              {#each schema.enum as choice}<option value={String(choice)}>{String(choice)}</option>{/each}
            </select>
          {:else if schema.type === 'boolean' && !required}
            <select value={value === undefined ? '' : String(value)} onchange={(event) => { if (event.currentTarget.value === '') clearField(key); else setField(key, event.currentTarget.value === 'true'); }}><option value="">Any</option><option value="true">True</option><option value="false">False</option></select>
          {:else if schema.type === 'boolean'}
            <span class="checkbox-field"><input type="checkbox" checked={Boolean(value)} onchange={(event) => setField(key, event.currentTarget.checked)} /> Enabled</span>
          {:else}
            <input type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'} value={editableFieldValue(value)} required={required} oninput={(event) => { const raw = event.currentTarget.value; if (!required && raw === '') clearField(key); else setField(key, schema.type === 'number' || schema.type === 'integer' ? Number(raw) : raw); }} />
          {/if}
          {#if !required && schema.type !== 'boolean' && !Array.isArray(schema.enum)}<button type="button" class="text-button" onclick={() => clearField(key)}>Unset</button>{/if}
        </label>
      {/each}
      <div class="schema-hint">Validated by the operation schema on the server.</div>
    </div>
  {:else}
    <div class="input-editor"><label for="input">Input <span>JSON / rich-value envelope</span></label><textarea id="input" value={inputText} oninput={(event) => onInputChange(event.currentTarget.value)} spellcheck="false" rows="9"></textarea><div class="schema-hint">Plain JSON is accepted; rich values are supported when the configured codec allows them.</div></div>
  {/if}
{/if}
