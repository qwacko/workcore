import { z } from 'zod';
import type { Definition, Job, Json, Operation } from './definitions.js';

export type FieldMetadata = {
  label?: string;
  description?: string;
  examples?: Json[];
  placeholder?: string;
  control?: 'text' | 'textarea' | 'email' | 'url' | 'password' | 'number' | 'checkbox' | 'select' | 'json';
  readOnly?: boolean;
  hidden?: boolean;
};
/** An ordinary Zod schema, with serialisable, typed field hints. Not a second schema language. */
type FieldControl<S extends z.ZodType> = NonNullable<z.output<S>> extends boolean ? 'checkbox' | 'json'
  : NonNullable<z.output<S>> extends number ? 'number' | 'select' | 'json'
  : NonNullable<z.output<S>> extends string ? 'text' | 'textarea' | 'email' | 'url' | 'password' | 'select' | 'json' : 'json';
export function field<S extends z.ZodType>(schema: S, metadata: Omit<FieldMetadata, 'control'> & { control?: FieldControl<S> }): S {
  const { label, description, examples, ...hints } = metadata;
  return schema.meta({
    ...schema.meta(),
    ...(label === undefined ? {} : { title: label }),
    ...(description === undefined ? {} : { description }),
    ...(examples === undefined ? {} : { examples }),
    'x-workcore': hints,
  }) as S;
}

type IsAny<T> = 0 extends (1 & T) ? true : false;
export type Path<T, D extends unknown[] = []> = IsAny<T> extends true ? string : D['length'] extends 5 ? never : T extends object ? {
  [K in keyof T & string]: K | (NonNullable<T[K]> extends object ? `${K}.${Path<NonNullable<T[K]>, [...D, 1]>}` : never)
}[keyof T & string] : never;
type At<T, P extends string> = P extends `${infer K}.${infer Rest}` ? K extends keyof T ? At<NonNullable<T[K]>, Rest> : never : P extends keyof T ? T[P] : never;
type CompatiblePath<T, V> = { [P in Path<T>]: Exclude<At<T, P>, undefined> extends Exclude<V, undefined> ? P : never }[Path<T>];
type Item<T> = T extends (infer R)[] ? R : T extends { rows: (infer R)[] } ? R : T;
type Bindings<R, I> = { [K in keyof I & string]?: CompatiblePath<R, I[K]> };
export type Column<P extends string = string> = { path: P; label?: string; format?: 'text' | 'badge' | 'date' };
export type LocalFilter<P extends string = string> = { path: P; label: string; options: { label: string; value: Json }[] };
export type OperationUI = { label?: string; description?: string; submitLabel?: string; presentation?: 'table' | 'list' | 'record' | 'json' | 'markdown' };
type Target = Operation | Job;
export type ActionDefinition = {
  kind: 'command' | 'form';
  target: Target;
  label: string;
  description?: string;
  confirm?: string;
  bind?: Record<string, string>;
  initial?: Record<string, string>;
  values?: Record<string, Json>;
  visibleWhen?: { path: string; equals: Json | { actor: true } };
  disabledWhen?: { path: string; equals: Json };
};
type ActionOptions<R, I> = Omit<ActionDefinition, 'kind' | 'target' | 'bind' | 'initial' | 'values' | 'visibleWhen' | 'disabledWhen'> & {
  bind?: Bindings<R, I>;
  initial?: Bindings<R, I>;
  values?: Partial<I>;
  visibleWhen?: { path: Path<R>; equals: Json | { actor: true } };
  disabledWhen?: { path: Path<R>; equals: Json };
};
type BlockBase = { title?: string; description?: string; input?: Json };
type SourceDefinition = { source: Operation } & BlockBase;
export type BlockDefinition = SourceDefinition & (
  | { kind: 'collection'; presentation?: 'table' | 'list'; columns?: Column[]; search?: string[]; filters?: LocalFilter[]; actions?: ActionDefinition[] }
  | { kind: 'record'; fields?: Column[] }
  | { kind: 'json' }
  | { kind: 'markdown'; path?: string }
  | { kind: 'chat'; messages: string; message: { id: string; role: string; content: string; at?: string }; send: ActionDefinition; promptField: string; runId?: string }
) | (BlockBase & { kind: 'form'; action: ActionDefinition });
export type PageDefinition = { title: string; description?: string; blocks: BlockDefinition[] };
export type AdminDefinition = { title?: string; description?: string; pages: Record<string, PageDefinition> };

function actions<R>() {
  return {
    command<I extends z.ZodType, O extends z.ZodType>(target: Operation<I, O> | Job<I, O>, options: ActionOptions<R, z.input<I>>): ActionDefinition {
      return { ...options, kind: 'command', target } as ActionDefinition;
    },
    form<I extends z.ZodType, O extends z.ZodType>(target: Operation<I, O> | Job<I, O>, options: ActionOptions<R, z.input<I>>): ActionDefinition {
      return { ...options, kind: 'form', target } as ActionDefinition;
    },
  };
}

export const ui = {
  page(definition: PageDefinition): PageDefinition { return definition; },
  collection<I extends z.ZodType, O extends z.ZodType>(source: Operation<I, O>, configure: (helpers: ReturnType<typeof actions<Item<z.output<O>>>>) => BlockBase & {
    input?: z.input<I>;
    presentation?: 'table' | 'list';
    columns?: Column<Path<Item<z.output<O>>>>[];
    search?: Path<Item<z.output<O>>>[];
    filters?: LocalFilter<Path<Item<z.output<O>>>>[];
    actions?: ActionDefinition[];
  }): BlockDefinition {
    return { ...configure(actions<Item<z.output<O>>>()), kind: 'collection', source } as BlockDefinition;
  },
  record<I extends z.ZodType, O extends z.ZodType>(source: Operation<I, O>, options: BlockBase & { input?: z.input<I>; fields?: Column<Path<z.output<O>>>[] } = {}): BlockDefinition {
    return { ...options, kind: 'record', source } as BlockDefinition;
  },
  json<I extends z.ZodType>(source: Operation<I>, options: BlockBase & { input?: z.input<I> } = {}): BlockDefinition { return { ...options, kind: 'json', source } as BlockDefinition; },
  markdown<I extends z.ZodType, O extends z.ZodType>(source: Operation<I, O>, options: BlockBase & { input?: z.input<I>; path?: Path<z.output<O>> } = {}): BlockDefinition {
    return { ...options, kind: 'markdown', source } as BlockDefinition;
  },
  form<I extends z.ZodType, O extends z.ZodType>(target: Operation<I, O> | Job<I, O>, options: Omit<BlockBase, 'input'> & { label: string; values?: Partial<z.input<I>>; confirm?: string } ): BlockDefinition {
    const { label, values, confirm, ...base } = options;
    return { ...base, kind: 'form', action: { kind: 'form', target, label, ...(values ? { values } : {}), ...(confirm ? { confirm } : {}) } } as BlockDefinition;
  },
  chat<I extends z.ZodType, O extends z.ZodType, SI extends z.ZodType, P extends Path<z.output<O>>>(source: Operation<I, O>, send: Operation<SI> | Job<SI>, options: BlockBase & {
    input?: z.input<I>; messages: P; message: { id: Path<Item<At<z.output<O>, P>>>; role: Path<Item<At<z.output<O>, P>>>; content: Path<Item<At<z.output<O>, P>>>; at?: Path<Item<At<z.output<O>, P>>> };
    promptField: keyof z.input<SI> & string; runId?: Path<z.output<O>>;
  }): BlockDefinition {
    return { ...options, kind: 'chat', source, send: { kind: 'form', target: send, label: 'Send message' } } as BlockDefinition;
  },
};

export type JsonSchema = {
  type?: string | string[]; title?: string; description?: string; default?: Json; examples?: Json[];
  properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: Json[]; const?: Json;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; format?: string;
  anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; $ref?: string; $defs?: Record<string, JsonSchema>;
  'x-workcore'?: Omit<FieldMetadata, 'label' | 'description' | 'examples'>;
  [key: string]: unknown;
};
const schemaSchema = z.custom<JsonSchema>(value => !!value && typeof value === 'object' && !Array.isArray(value));
const columnSchema = z.object({ path: z.string(), label: z.string().optional(), format: z.enum(['text', 'badge', 'date']).optional() });
const actionSchema = z.object({
  kind: z.enum(['command', 'form']), operation: z.object({ kind: z.enum(['mutation', 'job']), name: z.string() }),
  label: z.string(), description: z.string().optional(), confirm: z.string().optional(),
  bind: z.record(z.string(), z.string()).optional(), initial: z.record(z.string(), z.string()).optional(), values: z.record(z.string(), z.json()).optional(),
  visibleWhen: z.object({ path: z.string(), equals: z.json() }).optional(), disabledWhen: z.object({ path: z.string(), equals: z.json() }).optional(),
});
const sourceSchema = z.object({ kind: z.enum(['view', 'query']), name: z.string() });
const blockSchema = z.object({
  id: z.string(), kind: z.enum(['collection', 'record', 'json', 'markdown', 'form', 'chat']),
  title: z.string().optional(), description: z.string().optional(), input: z.json().optional(), source: sourceSchema.optional(),
  presentation: z.enum(['table', 'list']).optional(), columns: z.array(columnSchema).optional(), fields: z.array(columnSchema).optional(),
  search: z.array(z.string()).optional(), filters: z.array(z.object({ path: z.string(), label: z.string(), options: z.array(z.object({ label: z.string(), value: z.json() })) })).optional(),
  actions: z.array(actionSchema).optional(), action: actionSchema.optional(), path: z.string().optional(),
  messages: z.string().optional(), message: z.object({ id: z.string(), role: z.string(), content: z.string(), at: z.string().optional() }).optional(),
  send: actionSchema.optional(), promptField: z.string().optional(), runId: z.string().optional(),
});
const operationSchema = z.object({ input: schemaSchema, output: schemaSchema, ui: z.object({
  label: z.string().optional(), description: z.string().optional(), submitLabel: z.string().optional(), presentation: z.enum(['table', 'list', 'record', 'json', 'markdown']).optional(),
}).optional() });
export const manifestSchema = z.object({
  protocol: z.literal(2), actor: z.object({ id: z.string() }), admin: z.boolean(), runs: z.boolean(),
  files: z.object({ enabled: z.boolean(), upload: z.boolean(), list: z.boolean(), download: z.boolean(), delete: z.boolean() }),
  view: z.record(z.string(), operationSchema), query: z.record(z.string(), operationSchema),
  mutation: z.record(z.string(), operationSchema), job: z.record(z.string(), operationSchema),
  ui: z.object({ title: z.string(), description: z.string(), pages: z.record(z.string(), z.object({ title: z.string(), description: z.string().optional(), blocks: z.array(blockSchema) })) }),
});
export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestBlock = z.infer<typeof blockSchema>;
export type ManifestAction = z.infer<typeof actionSchema>;
export type ManifestOperation = z.infer<typeof operationSchema>;

/** Resolve object references once, then project the serialisable definition for this actor. */
export function compileAdmin(definition: Definition, permitted: (kind: string, name: string) => boolean): Manifest['ui'] {
  function schemaPath(schema: any, path: string): any {
    let current = schema;
    for (const part of path.split('.')) {
      if (['__proto__', 'constructor', 'prototype'].includes(part)) throw new Error(`Unsafe UI path: ${path}`);
      if (current?.anyOf) current = current.anyOf.find((part: any) => part.type !== 'null');
      current = current?.properties?.[part] ?? (typeof current?.additionalProperties === 'object' ? current.additionalProperties : undefined);
      if (!current) throw new Error(`Unknown UI data path: ${path}`);
    }
    return current;
  }
  function reference(target: unknown, kinds: ('view' | 'query' | 'mutation' | 'job')[]) {
    for (const kind of kinds) {
      const map = kind === 'view' ? definition.views : kind === 'query' ? definition.queries : kind === 'mutation' ? definition.mutations : definition.jobs;
      const name = Object.keys(map).find(name => map[name] === target);
      if (name) return { kind, name };
    }
    throw new Error('Admin references an unregistered operation');
  }
  function action(value: ActionDefinition, row?: JsonSchema): ManifestAction | null {
    const operation = reference(value.target, ['mutation', 'job']) as ManifestAction['operation'];
    const input = z.toJSONSchema(value.target.input, { io: 'input' }) as JsonSchema;
    for (const [field, path] of Object.entries({ ...value.initial, ...value.bind })) {
      if (!input.properties?.[field]) throw new Error(`Unknown action input field: ${field}`);
      if (!row) throw new Error('Row bindings require a collection source');
      schemaPath(row, path);
    }
    for (const field of Object.keys(value.values ?? {})) if (!input.properties?.[field]) throw new Error(`Unknown action input field: ${field}`);
    if (value.kind === 'command') for (const field of input.required ?? []) {
      if (!value.bind?.[field] && !value.initial?.[field] && !Object.hasOwn(value.values ?? {}, field) && input.properties?.[field]?.default === undefined) {
        throw new Error(`Command requires a binding or fixed value for ${field}`);
      }
    }
    if (row && value.visibleWhen) schemaPath(row, value.visibleWhen.path);
    if (row && value.disabledWhen) schemaPath(row, value.disabledWhen.path);
    if (!permitted(operation.kind, operation.name)) return null;
    const { target, ...options } = value;
    return { ...options, operation } as ManifestAction;
  }
  const pages: Manifest['ui']['pages'] = {};
  for (const [name, page] of Object.entries(definition.admin?.pages ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error(`Invalid admin page name: ${name}`);
    const blocks: ManifestBlock[] = [];
    for (const [index, block] of page.blocks.entries()) {
      const base = { id: `${name}-${index}`, ...block } as any;
      if (block.kind === 'form') {
        base.action = action(block.action);
        if (!base.action) continue;
      } else {
        base.source = reference(block.source, ['view', 'query']);
        if (!permitted(base.source.kind, base.source.name)) continue;
        const output = z.toJSONSchema(block.source.output) as JsonSchema;
        if (block.kind === 'collection') {
          const row = output.items ?? output.properties?.rows?.items ?? output;
          for (const path of [...(block.columns ?? []).map(column => column.path), ...(block.search ?? []), ...(block.filters ?? []).map(filter => filter.path)]) schemaPath(row, path);
          base.actions = (block.actions ?? []).map(value => action(value, row)).filter(Boolean);
        }
        if (block.kind === 'record') for (const column of block.fields ?? []) schemaPath(output, column.path);
        if (block.kind === 'markdown') {
          const content = block.path ? schemaPath(output, block.path) : output;
          if (content.type !== 'string' && !(Array.isArray(content.type) && content.type.includes('string')) && !content.anyOf?.some((part: JsonSchema) => part.type === 'string')) throw new Error('Markdown presentation requires a string result or string path');
        }
        if (block.kind === 'chat') {
          const messages = schemaPath(output, block.messages);
          if (messages.type !== 'array' || !messages.items) throw new Error('Chat messages must be an array');
          for (const path of Object.values(block.message)) if (path) schemaPath(messages.items, path);
          if (block.runId) schemaPath(output, block.runId);
          const input = z.toJSONSchema(block.send.target.input, { io: 'input' }) as JsonSchema;
          if (!input.properties?.[block.promptField]) throw new Error('Chat promptField must reference a send input field');
          base.send = action(block.send);
          // Preserve read-only chat even when the caller cannot send.
          if (!base.send) delete base.send;
        }
      }
      blocks.push(base as ManifestBlock);
    }
    if (blocks.length) pages[name] = { title: page.title, ...(page.description ? { description: page.description } : {}), blocks };
  }
  return { title: definition.admin?.title ?? 'Workcore', description: definition.admin?.description ?? 'Your live workspace and its operations.', pages };
}
