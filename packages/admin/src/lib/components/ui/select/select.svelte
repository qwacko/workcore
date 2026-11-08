<script lang="ts">
  import { Select as SelectPrimitive } from 'bits-ui';
  import { ChevronDown } from '@lucide/svelte';
  type Option = { value: string; label: string };
  let { value = $bindable(''), options, placeholder = 'Select an option', disabled = false, id, onchange }: {
    value?: string; options: Option[]; placeholder?: string; disabled?: boolean; id?: string; onchange?: (value: string) => void;
  } = $props();
</script>
<SelectPrimitive.Root type="single" bind:value onValueChange={next => onchange?.(next)} {disabled}>
  <SelectPrimitive.Trigger {id} class="inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50">
    <span>{options.find(option => option.value === value)?.label ?? placeholder}</span>
    <ChevronDown class="size-4 opacity-50" />
  </SelectPrimitive.Trigger>
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content class="z-50 max-h-72 min-w-32 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md" sideOffset={4}>
      {#each options as option (option.value)}
        <SelectPrimitive.Item value={option.value} label={option.label} class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50">{option.label}</SelectPrimitive.Item>
      {/each}
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
</SelectPrimitive.Root>
