import { z } from 'zod';
import type { Definition, Job, Json, Operation } from './definitions.js';

export type FieldMetadata = {
  label?: string;
  description?: string;
  examples?: Json[];
  placeholder?: string;
  control?: 'text' | 'textarea' | 'email' | 'url' | 'password' | 'number' | 'checkbox' | 'select' | 'json' | 'date' | 'datetime-local';
  readOnly?: boolean;
  hidden?: boolean;
  /** Registered local renderer name; renderer code never appears in the document. */
  renderer?: string;
  relationship?: RelationshipLookup;
  enumLabels?: Record<string, string>;
};
export type RelationshipLookup = {
  source: string;
  valuePath: string;
  labelPath: string;
  searchInput?: string;
  cursorInput?: string;
  selectedInput?: string;
};
/** An ordinary Zod schema, with serialisable, typed field hints. Not a second schema language. */
type FieldControl<S extends z.ZodType> = NonNullable<z.output<S>> extends boolean ? 'checkbox' | 'json'
  : NonNullable<z.output<S>> extends number ? 'number' | 'select' | 'json'
  : NonNullable<z.output<S>> extends string ? 'text' | 'textarea' | 'email' | 'url' | 'password' | 'select' | 'json' | 'date' | 'datetime-local' : 'json';
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
export type Column<P extends string = string> = { path: P; label?: string; format?: 'text' | 'badge' | 'date'; renderer?: string };
export type DisplayPropertyBinding = { $workcoreBinding: { kind: 'property'; path: string } };
export type DisplaySelectionBinding = { $workcoreBinding: { kind: 'selection'; node: string } };
export type DisplayStateBinding = { $workcoreBinding: { kind: 'state'; name: string } };
type AnyBinding = DisplayPropertyBinding | DisplaySelectionBinding | DisplayStateBinding;
type Bound<T> = T extends string | number | boolean | null ? T | AnyBinding
  : T extends (infer E)[] ? Bound<E>[] | AnyBinding
  : T extends object ? { [K in keyof T]: Bound<T[K]> } | AnyBinding : T | AnyBinding;
export type DisplayStateDefinition<S extends z.ZodType = z.ZodType> = { schema: S; default: z.input<S>; persistence?: 'memory' | 'url' };
type CollectionOptions<R, I> = BlockBase & {
  input?: Bound<I>;
  presentation?: 'table' | 'list';
  columns?: Column<Path<R>>[];
  search?: Path<R>[];
  filters?: LocalFilter<Path<R>>[];
  actions?: ActionDefinition[];
  detail?: DetailLink<R>;
  selection?: { key: Path<R> };
};
export type LocalFilter<P extends string = string> = { path: P; label: string; options: { label: string; value: Json }[] };
export type DetailLink<R = unknown> = { display: string; label?: string; bind: { [key: string]: Path<R> } };
export type OperationUI = { label?: string; description?: string; submitLabel?: string; presentation?: 'table' | 'list' | 'record' | 'json' | 'markdown' };
export type ChatPart = { type: 'text'; text: string } | { type: 'display'; mode: 'live' | 'snapshot'; display: string; input?: Json };
type Target = Operation | Job;
export type SuccessEffect =
  | { type: 'state.set'; name: string; value: Json }
  | { type: 'state.reset'; name: string }
  | { type: 'form.reset' }
  | { type: 'dialog.close' }
  | { type: 'source.refresh' }
  | { type: 'navigate'; display: string; bind: Record<string, string> };
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
  navigate?: { display: string; bind: Record<string, string> };
  effects?: SuccessEffect[];
};
type ActionOptions<R, I, O> = Omit<ActionDefinition, 'kind' | 'target' | 'bind' | 'initial' | 'values' | 'visibleWhen' | 'disabledWhen' | 'navigate'> & {
  bind?: Bindings<R, I>;
  initial?: Bindings<R, I>;
  values?: Partial<I>;
  visibleWhen?: { path: Path<R>; equals: Json | { actor: true } };
  disabledWhen?: { path: Path<R>; equals: Json };
  navigate?: { display: string; bind: { [key: string]: Path<O> } };
  effects?: SuccessEffect[];
};
type BlockBase = { id: string; title?: string; description?: string; input?: Json };
type SourceDefinition = { source: Operation } & BlockBase;
export type BlockDefinition = SourceDefinition & (
   | { kind: 'collection'; presentation?: 'table' | 'list'; columns?: Column[]; search?: string[]; filters?: LocalFilter[]; actions?: ActionDefinition[]; detail?: DetailLink; selection?: { key: string } }
  | { kind: 'record'; fields?: Column[] }
  | { kind: 'json' }
  | { kind: 'markdown'; path?: string }
  | { kind: 'chat'; messages: string; message: { id: string; role: string; content?: string; parts?: string; at?: string }; send: ActionDefinition; promptField: string; runId?: string }
) | (BlockBase & { kind: 'form'; action: ActionDefinition }) | (BlockBase & {
  kind: 'system'; system: 'resource' | 'operation-index' | 'operation' | 'run-detail'; resource?: 'runs' | 'schedules' | 'tables' | 'history' | 'files'; operation?: { kind: 'view' | 'query' | 'mutation' | 'job'; name: string };
}) | (BlockBase & { kind: 'custom'; component: string; version: number; props: Json; children?: BlockDefinition[] })
  | (BlockBase & { kind: 'section'; appearance?: 'card' | 'plain'; children: BlockDefinition[] })
  | (BlockBase & { kind: 'columns'; gap?: 'compact' | 'normal' | 'spacious'; columns: { id: string; children: BlockDefinition[] }[] })
  | (BlockBase & { kind: 'dialog'; triggerLabel: string; children: BlockDefinition[] })
  | (BlockBase & { kind: 'display'; display: string })
  | (BlockBase & { kind: 'state-control'; state: string; label: string; options: { label: string; value: Json }[] })
  | (BlockBase & { kind: 'button'; action: ActionDefinition; variant?: 'primary' | 'secondary' | 'danger' });
export type DisplayDocument = { blocks: BlockDefinition[]; state?: Record<string, DisplayStateDefinition> };
export type DisplayMetadata = {
  title: string;
  description?: string;
  icon?: string;
  group?: string;
  order?: number;
  route?: { path: string; listed?: boolean };
  classification?: 'application' | 'admin';
};
export type DisplayDefinition<I extends z.ZodType = z.ZodType, C = unknown> = {
  metadata: DisplayMetadata;
  input?: I;
  document?: DisplayDocument;
  handler?: (ctx: C, input: z.output<I>) => DisplayDocument;
};
export type ComponentDefinition<P extends z.ZodType = z.ZodType> = { version: number; props: P; placement?: 'block' | 'field' | 'cell' };
export type ComponentDefinitions = Record<string, ComponentDefinition>;
export type DisplaysDefinition<C = unknown, D extends Record<string, DisplayDefinition<any, C>> = Record<string, DisplayDefinition<any, C>>> = { title?: string; description?: string; displays: D; components?: ComponentDefinitions };

function actions<R>() {
  return {
    command<I extends z.ZodType, O extends z.ZodType>(target: Operation<I, O> | Job<I, O>, options: ActionOptions<R, z.input<I>, z.output<O>>): ActionDefinition {
      return { ...options, kind: 'command', target } as ActionDefinition;
    },
    form<I extends z.ZodType, O extends z.ZodType>(target: Operation<I, O> | Job<I, O>, options: ActionOptions<R, z.input<I>, z.output<O>>): ActionDefinition {
      return { ...options, kind: 'form', target } as ActionDefinition;
    },
  };
}

export const ui = {
  document(definition: DisplayDocument): DisplayDocument { return definition; },
  state<S extends z.ZodType>(schema: S, options: { default: z.input<S>; persistence?: 'memory' | 'url' }): DisplayStateDefinition<S> { return { schema, ...options }; },
  effect: {
    setState(name: string, value: Json): SuccessEffect { return { type: 'state.set', name, value }; },
    resetState(name: string): SuccessEffect { return { type: 'state.reset', name }; },
    resetForm(): SuccessEffect { return { type: 'form.reset' }; },
    closeDialog(): SuccessEffect { return { type: 'dialog.close' }; },
    refreshSources(): SuccessEffect { return { type: 'source.refresh' }; },
    navigate<O extends z.ZodType>(display: string, bind: Record<string, Path<z.output<O>>>): SuccessEffect { return { type: 'navigate', display, bind } as SuccessEffect; },
  },
  display<I extends z.ZodType, C = unknown>(definition: DisplayDefinition<I, C>): DisplayDefinition<I, C> { return definition; },
  system(options: BlockBase & ({ system: 'resource'; resource: 'runs' | 'schedules' | 'tables' | 'history' | 'files' } | { system: 'operation-index' } | { system: 'operation' } | { system: 'run-detail' })): BlockDefinition {
    return { ...options, kind: 'system' } as BlockDefinition;
  },
  displayReference(display: string, options: BlockBase & { input?: Json }): BlockDefinition {
    return { ...options, kind: 'display', display } as BlockDefinition;
  },
  stateControl(state: string, options: BlockBase & { label: string; options: { label: string; value: Json }[] }): BlockDefinition {
    return { ...options, kind: 'state-control', state } as BlockDefinition;
  },
  custom<P extends z.ZodType>(component: string, version: number, props: z.input<P>, options: BlockBase & { children?: BlockDefinition[] }): BlockDefinition {
    return { ...options, kind: 'custom', component, version, props } as BlockDefinition;
  },
  bind: {
    property(path: string): DisplayPropertyBinding { return { $workcoreBinding: { kind: 'property', path } }; },
    selection(node: string): DisplaySelectionBinding { return { $workcoreBinding: { kind: 'selection', node } }; },
    state(name: string): DisplayStateBinding { return { $workcoreBinding: { kind: 'state', name } }; },
  },
  section(options: BlockBase & { appearance?: 'card' | 'plain'; children: BlockDefinition[] }): BlockDefinition {
    return { ...options, kind: 'section' };
  },
  columns(options: BlockBase & { gap?: 'compact' | 'normal' | 'spacious'; columns: { id: string; children: BlockDefinition[] }[] }): BlockDefinition {
    return { ...options, kind: 'columns' };
  },
  dialog(options: BlockBase & { triggerLabel: string; children: BlockDefinition[] }): BlockDefinition {
    return { ...options, kind: 'dialog' };
  },
  button<I extends z.ZodType, O extends z.ZodType>(target: Operation<I, O> | Job<I, O>, options: Omit<BlockBase, 'input'> & { label: string; description?: string; values?: Partial<z.input<I>>; confirm?: string; variant?: 'primary' | 'secondary' | 'danger'; navigate?: { display: string; bind: { [key: string]: Path<z.output<O>> } }; effects?: SuccessEffect[] }): BlockDefinition {
    const { label, description, values, confirm, variant, navigate, effects, ...base } = options;
    return { ...base, kind: 'button', ...(variant ? { variant } : {}), action: { kind: 'form', target, label, ...(description ? { description } : {}), ...(values ? { values } : {}), ...(confirm ? { confirm } : {}), ...(navigate ? { navigate } : {}), ...(effects ? { effects } : {}) } } as BlockDefinition;
  },
  collection<I extends z.ZodType, O extends z.ZodType>(source: Operation<I, O>, configure: (helpers: ReturnType<typeof actions<Item<z.output<O>>>>) => BlockBase & {
    input?: Bound<z.input<I>>;
    presentation?: 'table' | 'list';
    columns?: Column<Path<Item<z.output<O>>>>[];
    search?: Path<Item<z.output<O>>>[];
    filters?: LocalFilter<Path<Item<z.output<O>>>>[];
    actions?: ActionDefinition[];
    detail?: DetailLink<Item<z.output<O>>>;
    selection?: { key: Path<Item<z.output<O>>> };
  }): BlockDefinition {
    return { ...configure(actions<Item<z.output<O>>>()), kind: 'collection', source } as BlockDefinition;
  },
  combined: {
    /**
     * Compose a responsive, typed collection + record detail view using ordinary wire nodes.
     * The selected value is a key only; the record source remains independently authorized.
     */
    masterDetail<LI extends z.ZodType, LO extends z.ZodType, DI extends z.ZodType, DO extends z.ZodType, K extends keyof z.input<DI> & string>(
      listSource: Operation<LI, LO>,
      detailSource: Operation<DI, DO>,
      options: Omit<CollectionOptions<Item<z.output<LO>>, z.input<LI>>, 'id' | 'title' | 'selection'> & {
        id: string;
        title: string;
        description?: string;
        key: CompatiblePath<Item<z.output<LO>>, z.input<DI>[K]>;
        detailInput: K;
        detailValues?: Omit<Bound<z.input<DI>>, K>;
        listTitle?: string;
        detailTitle?: string;
        listDescription?: string;
        detailDescription?: string;
        detailFields?: Column<Path<z.output<DO>>>[];
      },
    ): BlockDefinition {
      const id = (suffix: string) => {
        const value = `${options.id}-${suffix}`;
        if (value.length > 64) throw new Error(`Combined display node ID exceeds 64 characters: ${value}`);
        return value;
      };
      const listId = id('list');
      const detailId = id('detail');
      const { id: _id, title, description, key, detailInput, detailValues, listTitle, detailTitle, listDescription, detailDescription, detailFields, ...collectionOptions } = options;
      return {
        id: options.id,
        title,
        ...(description ? { description } : {}),
        kind: 'section',
        appearance: 'plain',
        children: [{
          id: id('columns'), kind: 'columns', columns: [
            { id: id('list-column'), children: [{ ...collectionOptions, id: listId, ...(listTitle === undefined ? {} : { title: listTitle }), ...(listDescription === undefined ? {} : { description: listDescription }), kind: 'collection', source: listSource, selection: { key } } as BlockDefinition] },
            { id: id('detail-column'), children: [{ id: detailId, ...(detailTitle === undefined ? {} : { title: detailTitle }), ...(detailDescription === undefined ? {} : { description: detailDescription }), kind: 'record', source: detailSource, input: { ...(detailValues ?? {}), [detailInput]: { $workcoreBinding: { kind: 'selection', node: listId } } }, ...(detailFields ? { fields: detailFields } : {}) } as BlockDefinition] },
          ],
        }],
      } as BlockDefinition;
    },
  },
  record<I extends z.ZodType, O extends z.ZodType>(source: Operation<I, O>, options: BlockBase & { input?: Bound<z.input<I>>; fields?: Column<Path<z.output<O>>>[] }): BlockDefinition {
    return { ...options, kind: 'record', source } as BlockDefinition;
  },
  json<I extends z.ZodType>(source: Operation<I>, options: BlockBase & { input?: Bound<z.input<I>> }): BlockDefinition { return { ...options, kind: 'json', source } as BlockDefinition; },
  markdown<I extends z.ZodType, O extends z.ZodType>(source: Operation<I, O>, options: BlockBase & { input?: Bound<z.input<I>>; path?: Path<z.output<O>> }): BlockDefinition {
    return { ...options, kind: 'markdown', source } as BlockDefinition;
  },
  form<I extends z.ZodType, O extends z.ZodType>(target: Operation<I, O> | Job<I, O>, options: Omit<BlockBase, 'input'> & { label: string; values?: Partial<z.input<I>>; confirm?: string; navigate?: { display: string; bind: { [key: string]: Path<z.output<O>> } }; effects?: SuccessEffect[] } ): BlockDefinition {
    const { label, values, confirm, navigate, effects, ...base } = options;
    return { ...base, kind: 'form', action: { kind: 'form', target, label, ...(values ? { values } : {}), ...(confirm ? { confirm } : {}), ...(navigate ? { navigate } : {}), ...(effects ? { effects } : {}) } } as BlockDefinition;
  },
  chat<I extends z.ZodType, O extends z.ZodType, SI extends z.ZodType, P extends Path<z.output<O>>>(source: Operation<I, O>, send: Operation<SI> | Job<SI>, options: BlockBase & {
    input?: z.input<I>; messages: P; message: { id: Path<Item<At<z.output<O>, P>>>; role: Path<Item<At<z.output<O>, P>>>; content?: Path<Item<At<z.output<O>, P>>>; parts?: Path<Item<At<z.output<O>, P>>>; at?: Path<Item<At<z.output<O>, P>>> };
    promptField: keyof z.input<SI> & string; runId?: Path<z.output<O>>;
  }): BlockDefinition {
    return { ...options, kind: 'chat', source, send: { kind: 'form', target: send, label: 'Send message' } } as BlockDefinition;
  },
};

export type JsonSchema = {
  type?: string | string[]; title?: string; description?: string; default?: Json; examples?: Json[];
  properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: Json[]; const?: Json;
  minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number; multipleOf?: number;
  minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; pattern?: string; format?: string;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; allOf?: JsonSchema[]; not?: JsonSchema; $ref?: string; $defs?: Record<string, JsonSchema>;
  'x-workcore'?: Omit<FieldMetadata, 'label' | 'description' | 'examples'>;
  [key: string]: unknown;
};
const schemaSchema = z.custom<JsonSchema>(value => !!value && typeof value === 'object' && !Array.isArray(value));
export const MAX_DISPLAY_NODES = 200;
export const MAX_DISPLAY_BYTES = 512 * 1024;
export const MAX_DISPLAY_DEPTH = 12;
const columnSchema = z.object({ path: z.string(), label: z.string().optional(), format: z.enum(['text', 'badge', 'date']).optional(), renderer: z.string().optional() });
const actionSchema = z.object({
  kind: z.enum(['command', 'form']), operation: z.object({ kind: z.enum(['mutation', 'job']), name: z.string() }),
  label: z.string(), description: z.string().optional(), confirm: z.string().optional(),
  bind: z.record(z.string(), z.string()).optional(), initial: z.record(z.string(), z.string()).optional(), values: z.record(z.string(), z.json()).optional(),
  visibleWhen: z.object({ path: z.string(), equals: z.json() }).optional(), disabledWhen: z.object({ path: z.string(), equals: z.json() }).optional(),
  navigate: z.object({ display: z.string(), bind: z.record(z.string(), z.string()) }).optional(),
  effects: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('state.set'), name: z.string(), value: z.json() }),
    z.object({ type: z.literal('state.reset'), name: z.string() }),
    z.object({ type: z.literal('form.reset') }),
    z.object({ type: z.literal('dialog.close') }),
    z.object({ type: z.literal('source.refresh') }),
    z.object({ type: z.literal('navigate'), display: z.string(), bind: z.record(z.string(), z.string()) }),
  ])).optional(),
});
export type ManifestAction = z.infer<typeof actionSchema>;
const sourceSchema = z.object({ kind: z.enum(['view', 'query']), name: z.string() });
const blockBaseSchema = z.object({ id: z.string().min(1).max(64), title: z.string().optional(), description: z.string().optional() });
const sourceBlockBaseSchema = blockBaseSchema.extend({ source: sourceSchema, input: z.json().optional() });
const filterSchema = z.object({ path: z.string(), label: z.string(), options: z.array(z.object({ label: z.string(), value: z.json() })) });
const detailSchema = z.object({ display: z.string(), label: z.string().optional(), bind: z.record(z.string(), z.string()) });
const chatMessageSchema = z.object({ id: z.string(), role: z.string(), content: z.string().optional(), parts: z.string().optional(), at: z.string().optional() });
const systemOperationSchema = z.object({ kind: z.enum(['view', 'query', 'mutation', 'job']), name: z.string() });

type ManifestBlockBase = { id: string; title?: string; description?: string };
export type ManifestBlock =
  | (ManifestBlockBase & { kind: 'collection'; source: z.infer<typeof sourceSchema>; input?: Json; presentation?: 'table' | 'list'; columns?: z.infer<typeof columnSchema>[]; search?: string[]; filters?: z.infer<typeof filterSchema>[]; actions?: ManifestAction[]; detail?: z.infer<typeof detailSchema>; selection?: { key: string } })
  | (ManifestBlockBase & { kind: 'record'; source: z.infer<typeof sourceSchema>; input?: Json; fields?: z.infer<typeof columnSchema>[] })
  | (ManifestBlockBase & { kind: 'json'; source: z.infer<typeof sourceSchema>; input?: Json })
  | (ManifestBlockBase & { kind: 'markdown'; source: z.infer<typeof sourceSchema>; input?: Json; path?: string })
  | (ManifestBlockBase & { kind: 'chat'; source: z.infer<typeof sourceSchema>; input?: Json; messages: string; message: z.infer<typeof chatMessageSchema>; send?: ManifestAction; promptField: string; runId?: string })
  | (ManifestBlockBase & { kind: 'display'; display: string; input?: Json })
  | (ManifestBlockBase & { kind: 'state-control'; state: string; label: string; options: { label: string; value: Json }[] })
  | (ManifestBlockBase & { kind: 'form'; action: ManifestAction })
  | (ManifestBlockBase & { kind: 'button'; action: ManifestAction; variant?: 'primary' | 'secondary' | 'danger' })
  | (ManifestBlockBase & { kind: 'system'; system: 'resource' | 'operation-index' | 'operation' | 'run-detail'; resource?: 'runs' | 'schedules' | 'tables' | 'history' | 'files'; operation?: z.infer<typeof systemOperationSchema> })
  | (ManifestBlockBase & { kind: 'custom'; component: string; version: number; props: Json; children?: ManifestBlock[] })
  | (ManifestBlockBase & { kind: 'section'; appearance?: 'card' | 'plain'; children: ManifestBlock[] })
  | (ManifestBlockBase & { kind: 'columns'; gap?: 'compact' | 'normal' | 'spacious'; columns: { id: string; children: ManifestBlock[] }[] })
  | (ManifestBlockBase & { kind: 'dialog'; triggerLabel: string; children: ManifestBlock[] });
export type ManifestSourceBlock = Extract<ManifestBlock, { source: unknown }>;
let blockSchema: z.ZodType<ManifestBlock>;
const childNodesSchema = z.array(z.lazy(() => blockSchema)).max(MAX_DISPLAY_NODES);
blockSchema = z.lazy(() => z.discriminatedUnion('kind', [
  sourceBlockBaseSchema.extend({ kind: z.literal('collection'), presentation: z.enum(['table', 'list']).optional(), columns: z.array(columnSchema).optional(), search: z.array(z.string()).optional(), filters: z.array(filterSchema).optional(), actions: z.array(actionSchema).optional(), detail: detailSchema.optional(), selection: z.object({ key: z.string() }).optional() }),
  sourceBlockBaseSchema.extend({ kind: z.literal('record'), fields: z.array(columnSchema).optional() }),
  sourceBlockBaseSchema.extend({ kind: z.literal('json') }),
  sourceBlockBaseSchema.extend({ kind: z.literal('markdown'), path: z.string().optional() }),
  sourceBlockBaseSchema.extend({ kind: z.literal('chat'), messages: z.string(), message: chatMessageSchema, send: actionSchema.optional(), promptField: z.string(), runId: z.string().optional() }),
  blockBaseSchema.extend({ kind: z.literal('display'), display: z.string(), input: z.json().optional() }),
  blockBaseSchema.extend({ kind: z.literal('state-control'), state: z.string(), label: z.string(), options: z.array(z.object({ label: z.string(), value: z.json() })).min(1) }),
  blockBaseSchema.extend({ kind: z.literal('form'), action: actionSchema }),
  blockBaseSchema.extend({ kind: z.literal('button'), action: actionSchema, variant: z.enum(['primary', 'secondary', 'danger']).optional() }),
  blockBaseSchema.extend({ kind: z.literal('system'), system: z.enum(['resource', 'operation-index', 'operation', 'run-detail']), resource: z.enum(['runs', 'schedules', 'tables', 'history', 'files']).optional(), operation: systemOperationSchema.optional() }),
  blockBaseSchema.extend({ kind: z.literal('custom'), component: z.string(), version: z.number().int().positive(), props: z.json(), children: childNodesSchema.optional() }),
  blockBaseSchema.extend({ kind: z.literal('section'), appearance: z.enum(['card', 'plain']).optional(), children: childNodesSchema }),
  blockBaseSchema.extend({ kind: z.literal('columns'), gap: z.enum(['compact', 'normal', 'spacious']).optional(), columns: z.array(z.object({ id: z.string().min(1).max(64), children: childNodesSchema })).min(1).max(4) }),
  blockBaseSchema.extend({ kind: z.literal('dialog'), triggerLabel: z.string().min(1).max(120), children: childNodesSchema }),
]) as z.ZodType<ManifestBlock>);
const displayStateSchema = z.record(z.string(), z.object({ schema: schemaSchema, default: z.json(), persistence: z.enum(['memory', 'url']) }));
export const displayDocumentSchema = z.object({ blocks: z.array(blockSchema).max(MAX_DISPLAY_NODES), state: displayStateSchema.optional() }).superRefine((document, context) => {
  let count = 0;
  const ids = new Set<string>();
  const visit = (node: ManifestBlock, depth: number, path: (string | number)[]) => {
    count++;
    if (depth > MAX_DISPLAY_DEPTH) context.addIssue({ code: 'custom', path, message: `Display nesting exceeds the ${MAX_DISPLAY_DEPTH}-level limit` });
    if (count > MAX_DISPLAY_NODES) context.addIssue({ code: 'custom', path, message: `Display exceeds the ${MAX_DISPLAY_NODES}-node limit` });
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(node.id) || ids.has(node.id)) context.addIssue({ code: 'custom', path: [...path, 'id'], message: `Invalid or duplicate node ID: ${node.id}` });
    ids.add(node.id);
    if ('children' in node && node.children) node.children.forEach((child, index) => visit(child, depth + 1, [...path, 'children', index]));
    if (node.kind === 'columns') node.columns.forEach((column, columnIndex) => column.children.forEach((child, index) => visit(child, depth + 1, [...path, 'columns', columnIndex, 'children', index])));
  };
  document.blocks.forEach((block, index) => visit(block, 1, ['blocks', index]));
});
const operationSchema = z.object({ input: schemaSchema, output: schemaSchema, ui: z.object({
  label: z.string().optional(), description: z.string().optional(), submitLabel: z.string().optional(), presentation: z.enum(['table', 'list', 'record', 'json', 'markdown']).optional(),
}).optional() });
export const manifestSchema = z.object({
  protocol: z.literal(3), displayProtocol: z.literal(3), actor: z.object({ id: z.string() }), admin: z.boolean(), runs: z.boolean(),
  files: z.object({ enabled: z.boolean(), upload: z.boolean(), list: z.boolean(), download: z.boolean(), delete: z.boolean() }),
  view: z.record(z.string(), operationSchema), query: z.record(z.string(), operationSchema),
  mutation: z.record(z.string(), operationSchema), job: z.record(z.string(), operationSchema),
  system: z.record(z.string(), operationSchema),
  ui: z.object({ title: z.string(), description: z.string(), displays: z.record(z.string(), z.object({ metadata: z.object({
    title: z.string(), description: z.string().optional(), icon: z.string().optional(), group: z.string().optional(), order: z.number().optional(),
    route: z.object({ path: z.string(), listed: z.boolean().optional() }).optional(), classification: z.enum(['application', 'admin']).optional(),
   }), input: schemaSchema.optional(), document: displayDocumentSchema.optional() })), components: z.record(z.string(), z.object({ version: z.number().int().positive(), placement: z.enum(['block', 'field', 'cell']).default('block'), props: schemaSchema })).default({}) }),
});
export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestDisplay = Manifest['ui']['displays'][string];
export type ManifestDocument = NonNullable<ManifestDisplay['document']>;
export type ManifestOperation = z.infer<typeof operationSchema>;

/** Resolve object references once, then project the serialisable definition for this actor. */

/** Validate JSON values against the JSON Schema subset emitted for declared display state. */
function matchesJsonSchema(schema: JsonSchema, value: Json, root: JsonSchema = schema, seen = new Set<string>()): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (!ref.startsWith('#/$defs/')) return false;
    if (seen.has(ref)) return true;
    const target = ref.slice('#/$defs/'.length).split('/').reduce<any>((current, key) => current?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], (root as any).$defs);
    if (!target) return false;
    const nextSeen = new Set(seen); nextSeen.add(ref);
    return matchesJsonSchema(target, value, root, nextSeen);
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (schema.allOf && !schema.allOf.every(part => matchesJsonSchema(part, value, root, seen))) return false;
  if (schema.anyOf && !schema.anyOf.some(part => matchesJsonSchema(part, value, root, seen))) return false;
  if (schema.oneOf && schema.oneOf.filter(part => matchesJsonSchema(part, value, root, seen)).length !== 1) return false;
  if (schema.not && matchesJsonSchema(schema.not, value, root, seen)) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => type === 'null' ? value === null
    : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : type === 'string' ? typeof value === 'string'
    : type === 'boolean' ? typeof value === 'boolean' : false)) return false;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern).test(value))) return false;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum || schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return false;
    if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every(item => matchesJsonSchema(schema.items!, item, root, seen))) return false;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, Json>;
    if (schema.required?.some(key => !Object.hasOwn(record, key))) return false;
    for (const [key, item] of Object.entries(record)) {
      const property = schema.properties?.[key];
      if (property) { if (!matchesJsonSchema(property, item, root, seen)) return false; }
      else if (schema.additionalProperties === false) return false;
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !matchesJsonSchema(schema.additionalProperties, item, root, seen)) return false;
    }
  }
  return true;
}

export function compileDisplays(
  definition: Definition,
  permitted: (kind: string, name: string) => boolean,
): Manifest['ui'] {
  const components = Object.fromEntries(Object.entries(definition.displays?.components ?? {}).map(([name, component]) => {
    if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Custom component names must be namespaced: ${name}`);
    if (!Number.isSafeInteger(component.version) || component.version < 1) throw new Error(`Invalid custom component version: ${name}`);
    return [name, { version: component.version, placement: component.placement ?? 'block', props: JSON.parse(JSON.stringify(z.toJSONSchema(component.props, { io: 'input' }))) as JsonSchema }];
  }));
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
  function renderer(name: string, placement: 'block' | 'field' | 'cell'): void {
    const component = definition.displays?.components?.[name];
    if (!component) throw new Error(`Unknown UI renderer: ${name}`);
    if ((component.placement ?? 'block') !== placement) throw new Error(`Renderer ${name} is registered for ${(component.placement ?? 'block')} nodes, not ${placement}`);
  }
  function validateFieldRenderers(schema: JsonSchema): void {
    const hinted = schema['x-workcore']?.renderer;
    if (typeof hinted === 'string') renderer(hinted, 'field');
    for (const child of Object.values(schema.properties ?? {})) validateFieldRenderers(child);
    if (schema.items) validateFieldRenderers(schema.items);
    for (const child of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) validateFieldRenderers(child);
  }
  function validateRelationshipLookups(schema: JsonSchema): void {
    const lookup = schema['x-workcore']?.relationship as RelationshipLookup | undefined;
    if (lookup) {
      const view = definition.views[lookup.source];
      if (!view) throw new Error(`Relationship lookup must reference a registered view: ${lookup.source}`);
      const output = z.toJSONSchema(view.output) as JsonSchema;
      const row = output.items ?? output.properties?.rows?.items ?? output;
      schemaPath(row, lookup.valuePath);
      schemaPath(row, lookup.labelPath);
      const input = z.toJSONSchema(view.input, { io: 'input' }) as JsonSchema;
      for (const field of [lookup.searchInput, lookup.cursorInput, lookup.selectedInput].filter((value): value is string => !!value)) {
        if (!input.properties?.[field]) throw new Error(`Unknown relationship lookup input ${field} on ${lookup.source}`);
      }
    }
    for (const child of Object.values(schema.properties ?? {})) validateRelationshipLookups(child);
    if (schema.items) validateRelationshipLookups(schema.items);
    for (const child of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) validateRelationshipLookups(child);
  }
  function validateBoundInput(value: Json | undefined, target: JsonSchema, properties: JsonSchema | undefined, selections: Map<string, JsonSchema> = new Map(), states: Map<string, JsonSchema> = new Map()): void {
    if (value === undefined) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Display source input must be an object');
    const supplied = value as Record<string, Json>;
    for (const [key, entry] of Object.entries(supplied)) {
      const targetField = target.properties?.[key];
      if (!targetField) throw new Error(`Unknown display source input: ${key}`);
      const validateEntry = (candidate: Json, fieldSchema: JsonSchema, fieldPath: string): void => {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && Object.keys(candidate).length === 1 && '$workcoreBinding' in candidate) {
        const binding = (candidate as unknown as AnyBinding).$workcoreBinding;
        if (!binding) throw new Error('Invalid display input binding');
        let boundSchema: JsonSchema | undefined;
        let bindingName: string;
        if (binding.kind === 'property' && typeof binding.path === 'string') {
          if (!properties) throw new Error(`Display input binding ${binding.path} requires declared display properties`);
          boundSchema = schemaPath(properties, binding.path);
          bindingName = binding.path;
        } else if (binding.kind === 'selection' && typeof binding.node === 'string') {
          boundSchema = selections.get(binding.node);
          if (!boundSchema) throw new Error(`Unknown or non-selectable collection node: ${binding.node}`);
          bindingName = `selection:${binding.node}`;
        } else if (binding.kind === 'state' && typeof binding.name === 'string') {
          boundSchema = states.get(binding.name);
          if (!boundSchema) throw new Error(`Unknown display state variable: ${binding.name}`);
          bindingName = `state:${binding.name}`;
        } else throw new Error('Invalid display input binding');
        const sourceType = fieldSchema.anyOf?.find(part => part.type !== 'null')?.type ?? fieldSchema.type;
        if (!boundSchema) throw new Error(`Invalid display input binding for ${fieldPath}`);
        const propertyType = boundSchema.anyOf?.find((part: JsonSchema) => part.type !== 'null')?.type ?? boundSchema.type;
        if (sourceType && propertyType && sourceType !== propertyType && !(Array.isArray(sourceType) && sourceType.includes(propertyType as string))) {
          throw new Error(`Incompatible display binding ${bindingName} for source input ${fieldPath}`);
        }
        return;
        }
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          const propertiesSchema = fieldSchema.properties ?? {};
          for (const [childKey, childValue] of Object.entries(candidate)) {
            const childSchema = propertiesSchema[childKey];
            if (!childSchema) throw new Error(`Unknown display source input: ${fieldPath}.${childKey}`);
            validateEntry(childValue, childSchema, `${fieldPath}.${childKey}`);
          }
        } else if (Array.isArray(candidate) && fieldSchema.items) {
          candidate.forEach((childValue, index) => validateEntry(childValue, fieldSchema.items!, `${fieldPath}[${index}]`));
        }
      };
      validateEntry(entry, targetField, key);
    }
    for (const key of target.required ?? []) {
      if (!Object.hasOwn(supplied, key) && target.properties?.[key]?.default === undefined) throw new Error(`Display source input requires a binding or value for ${key}`);
    }
  }
  function reference(target: unknown, kinds: ('view' | 'query' | 'mutation' | 'job')[]) {
    for (const kind of kinds) {
      const map = kind === 'view' ? definition.views : kind === 'query' ? definition.queries : kind === 'mutation' ? definition.mutations : definition.jobs;
      const name = Object.keys(map).find(name => map[name] === target);
      if (name) return { kind, name };
    }
    throw new Error('Admin references an unregistered operation');
  }
  function action(value: ActionDefinition, row?: JsonSchema, states: Map<string, JsonSchema> = new Map(), stateValidators: Map<string, (value: Json) => boolean> = new Map()): ManifestAction | null {
    const operation = reference(value.target, ['mutation', 'job']) as ManifestAction['operation'];
    const input = z.toJSONSchema(value.target.input, { io: 'input' }) as JsonSchema;
    validateFieldRenderers(input);
    validateRelationshipLookups(input);
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
    let navigate = value.navigate;
    if (navigate) {
      const targetDisplay = definition.displays?.displays[navigate.display];
      if (!targetDisplay?.metadata.route?.path || !targetDisplay.input) throw new Error(`Success navigation must target a parameterized routed display: ${navigate.display}`);
      const destination = z.toJSONSchema(targetDisplay.input, { io: 'input' }) as JsonSchema;
      const result = z.toJSONSchema(value.target.output) as JsonSchema;
      for (const [field, path] of Object.entries(navigate.bind)) {
        if (!destination.properties?.[field]) throw new Error(`Unknown success navigation input: ${field}`);
        schemaPath(result, path);
      }
      if (!permitted('display', navigate.display)) navigate = undefined;
    }
    const effects = value.effects?.filter(effect => {
      if (effect.type === 'state.set' || effect.type === 'state.reset') {
        const state = states.get(effect.name);
        if (!state) throw new Error(`Unknown display state variable in effect: ${effect.name}`);
        if (effect.type === 'state.set' && !(stateValidators.get(effect.name)?.(effect.value) ?? matchesJsonSchema(state, effect.value))) throw new Error(`Invalid state effect value for ${effect.name}`);
      } else if (effect.type === 'navigate') {
        const targetDisplay = definition.displays?.displays[effect.display];
        if (!targetDisplay?.metadata.route?.path || !targetDisplay.input) throw new Error(`Success navigation must target a parameterized routed display: ${effect.display}`);
        const destination = z.toJSONSchema(targetDisplay.input, { io: 'input' }) as JsonSchema;
        const result = z.toJSONSchema(value.target.output) as JsonSchema;
        for (const [field, path] of Object.entries(effect.bind)) {
          if (!destination.properties?.[field]) throw new Error(`Unknown success navigation input: ${field}`);
          schemaPath(result, path);
        }
        if (!permitted('display', effect.display)) return false;
      }
      return true;
    });
    const { target, navigate: _navigation, ...options } = value;
    const filteredEffects = effects?.map(effect => effect.type === 'navigate' && !permitted('display', effect.display) ? undefined : effect).filter((effect): effect is SuccessEffect => !!effect);
    return { ...options, ...(navigate ? { navigate } : {}), ...(filteredEffects?.length ? { effects: filteredEffects } : {}), operation } as ManifestAction;
  }
  const displays: Manifest['ui']['displays'] = {};
  for (const [name, display] of Object.entries(definition.displays?.displays ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error(`Invalid display name: ${name}`);
    if (!permitted('display', name)) continue;
    const route = display.metadata.route?.path;
    if (route && (!route.startsWith('/') || route.startsWith('//') || route.split('/').some(part => part === '.' || part === '..'))) throw new Error(`Invalid route path for display ${name}`);
    if ([display.document, display.handler].filter(Boolean).length !== 1) throw new Error(`Display ${name} must define exactly one of document or resolver`);
    const input = display.input ? JSON.parse(JSON.stringify(z.toJSONSchema(display.input, { io: 'input' }))) as JsonSchema : undefined;
    if (!display.document) {
      displays[name] = { metadata: display.metadata, ...(input ? { input } : {}) };
      continue;
    }
    let visitedNodes = 0;
    const nodeIds = new Set<string>();
    const selectionSchemas = new Map<string, JsonSchema>();
    const stateSchemas = new Map<string, JsonSchema>();
    const stateValidators = new Map<string, (value: Json) => boolean>();
    const manifestState: Record<string, { schema: JsonSchema; default: Json; persistence: 'memory' | 'url' }> = {};
      for (const [stateName, stateDefinition] of Object.entries(display.document.state ?? {})) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(stateName)) throw new Error(`Invalid display state name in ${name}: ${stateName}`);
        const parsedDefault = stateDefinition.schema.parse(stateDefinition.default) as Json;
        const schema = JSON.parse(JSON.stringify(z.toJSONSchema(stateDefinition.schema, { io: 'input' }))) as JsonSchema;
        stateSchemas.set(stateName, schema);
        stateValidators.set(stateName, value => {
          const parsed = stateDefinition.schema.safeParse(value);
          return parsed.success;
        });
        manifestState[stateName] = { schema, default: parsedDefault, persistence: stateDefinition.persistence ?? 'memory' };
      }
    const collectSelections = (block: BlockDefinition) => {
      if (block.kind === 'collection' && block.selection) {
        const source = reference(block.source, ['view', 'query']);
        const sourceDefinition = (source.kind === 'view' ? definition.views[source.name] : definition.queries[source.name])!;
        const output = z.toJSONSchema(sourceDefinition.output) as JsonSchema;
        const row = output.items ?? output.properties?.rows?.items ?? output;
        selectionSchemas.set(block.id, schemaPath(row, block.selection.key));
      }
      if ('children' in block && block.children) block.children.forEach(collectSelections);
      if (block.kind === 'columns') block.columns.forEach(column => column.children.forEach(collectSelections));
    };
    display.document.blocks.forEach(collectSelections);
    const compileNode = (block: BlockDefinition, depth: number): ManifestBlock | null => {
      visitedNodes++;
      if (visitedNodes > MAX_DISPLAY_NODES) throw new Error(`Display ${name} exceeds the ${MAX_DISPLAY_NODES}-node limit`);
      if (depth > MAX_DISPLAY_DEPTH) throw new Error(`Display ${name} exceeds the ${MAX_DISPLAY_DEPTH}-level nesting limit`);
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(block.id) || nodeIds.has(block.id)) throw new Error(`Invalid or duplicate node ID in display ${name}: ${block.id}`);
      nodeIds.add(block.id);
      const base = { ...block } as any;
      if (block.kind === 'section' || block.kind === 'dialog') {
        base.children = block.children.map(child => compileNode(child, depth + 1)).filter((child): child is ManifestBlock => !!child);
        return base as ManifestBlock;
      }
      if (block.kind === 'columns') {
        const columnIds = new Set<string>();
        base.columns = block.columns.map(column => {
          if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(column.id) || columnIds.has(column.id)) throw new Error(`Invalid or duplicate column ID in display ${name}: ${column.id}`);
          columnIds.add(column.id);
          return { ...column, children: column.children.map(child => compileNode(child, depth + 1)).filter((child): child is ManifestBlock => !!child) };
        });
        return base as ManifestBlock;
      }
      if (block.kind === 'custom') {
        const component = definition.displays?.components?.[block.component];
        if (!component || component.version !== block.version) throw new Error(`Unknown or incompatible custom component: ${block.component}@${block.version}`);
        renderer(block.component, 'block');
        base.props = component.props.parse(block.props) as Json;
        if (block.children) base.children = block.children.map(child => compileNode(child, depth + 1)).filter((child): child is ManifestBlock => !!child);
        return base as ManifestBlock;
      }
      if (block.kind === 'system') {
        if (block.system === 'resource' && !block.resource) throw new Error(`Incomplete system node in display ${name}: ${block.id}`);
        return base as ManifestBlock;
      }
      if (block.kind === 'state-control') {
        const stateSchema = stateSchemas.get(block.state);
        if (!stateSchema) throw new Error(`Unknown display state variable: ${block.state}`);
        if (!Array.isArray(stateSchema.enum)) throw new Error(`State control ${block.id} requires an enum state schema`);
        const allowedValues = new Set(stateSchema.enum.map(value => JSON.stringify(value)));
        if (block.options.some(option => !allowedValues.has(JSON.stringify(option.value)))) throw new Error(`State control ${block.id} has an option outside ${block.state}'s enum`);
        return base as ManifestBlock;
      }
      if (block.kind === 'display') {
        const targetDisplay = definition.displays?.displays[block.display];
        if (!targetDisplay || !permitted('display', block.display)) return null;
        const targetInput = targetDisplay.input ? z.toJSONSchema(targetDisplay.input, { io: 'input' }) as JsonSchema : { type: 'object', properties: {}, required: [] };
        if (block.input !== undefined) validateBoundInput(block.input, targetInput, input, selectionSchemas, stateSchemas);
        const supplied = block.input && typeof block.input === 'object' && !Array.isArray(block.input) ? block.input as Record<string, Json> : {};
        for (const key of targetInput.required ?? []) if (!Object.hasOwn(supplied, key) && targetInput.properties?.[key]?.default === undefined) throw new Error(`Display reference ${block.display} requires input ${key}`);
        return base as ManifestBlock;
      }
      if (block.kind === 'form' || block.kind === 'button') {
        base.action = action(block.action, undefined, stateSchemas, stateValidators);
        return base.action ? base as ManifestBlock : null;
      }
      base.source = reference(block.source, ['view', 'query']);
      if (!permitted(base.source.kind, base.source.name)) return null;
      const sourceDefinition = (base.source.kind === 'view' ? definition.views[base.source.name] : definition.queries[base.source.name])!;
      validateBoundInput(block.input, z.toJSONSchema(sourceDefinition.input, { io: 'input' }) as JsonSchema, input, selectionSchemas, stateSchemas);
      const output = z.toJSONSchema(block.source.output) as JsonSchema;
      if (block.kind === 'collection') {
        const row = output.items ?? output.properties?.rows?.items ?? output;
        for (const path of [...(block.columns ?? []).map(column => column.path), ...(block.search ?? []), ...(block.filters ?? []).map(filter => filter.path)]) schemaPath(row, path);
        for (const column of block.columns ?? []) if (column.renderer) renderer(column.renderer, 'cell');
        base.actions = (block.actions ?? []).map(value => action(value, row, stateSchemas, stateValidators)).filter(Boolean);
        if (block.detail) {
          const target = definition.displays?.displays[block.detail.display];
          if (!target?.metadata.route?.path) throw new Error(`Detail display must declare a route: ${block.detail.display}`);
          const targetInput = target.input ? z.toJSONSchema(target.input, { io: 'input' }) as JsonSchema : {};
          for (const [field, path] of Object.entries(block.detail.bind)) {
            if (!targetInput.properties?.[field]) throw new Error(`Unknown detail display input: ${field}`);
            schemaPath(row, path);
          }
        }
      }
      if (block.kind === 'record') for (const column of block.fields ?? []) { schemaPath(output, column.path); if (column.renderer) renderer(column.renderer, 'cell'); }
      if (block.kind === 'markdown') {
        const content = block.path ? schemaPath(output, block.path) : output;
        if (content.type !== 'string' && !(Array.isArray(content.type) && content.type.includes('string')) && !content.anyOf?.some((part: JsonSchema) => part.type === 'string')) throw new Error('Markdown presentation requires a string result or string path');
      }
      if (block.kind === 'chat') {
        const messages = schemaPath(output, block.messages);
        if (messages.type !== 'array' || !messages.items) throw new Error('Chat messages must be an array');
        if (!block.message.content && !block.message.parts) throw new Error('Chat messages require a content or parts path');
        if (block.message.content) {
          const content = schemaPath(messages.items, block.message.content);
          if (content.type !== 'string' && !(Array.isArray(content.type) && content.type.includes('string'))) throw new Error('Chat content must be a string path');
        }
        if (block.message.parts) {
          const parts = schemaPath(messages.items, block.message.parts);
          if (parts.type !== 'array' || !parts.items) throw new Error('Chat parts must be an array path');
        }
        for (const path of Object.values(block.message)) if (path) schemaPath(messages.items, path);
        if (block.runId) schemaPath(output, block.runId);
        const sendInput = z.toJSONSchema(block.send.target.input, { io: 'input' }) as JsonSchema;
        if (!sendInput.properties?.[block.promptField]) throw new Error('Chat promptField must reference a send input field');
        base.send = action(block.send, undefined, stateSchemas, stateValidators);
        // Preserve read-only chat even when the caller cannot send.
        if (!base.send) delete base.send;
      }
      return base as ManifestBlock;
    };
    const blocks = display.document.blocks.map(block => compileNode(block, 1)).filter((block): block is ManifestBlock => !!block);
    if (blocks.length) {
      const compiled = { metadata: display.metadata, ...(input ? { input } : {}), document: { blocks, ...(Object.keys(manifestState).length ? { state: manifestState } : {}) } };
      const bytes = new TextEncoder().encode(JSON.stringify(compiled)).byteLength;
      if (bytes > MAX_DISPLAY_BYTES) throw new Error(`Display ${name} exceeds the ${MAX_DISPLAY_BYTES}-byte limit`);
      displays[name] = compiled;
    }
  }
  return { title: definition.displays?.title ?? 'Workcore', description: definition.displays?.description ?? 'Your live workspace and its operations.', displays, components };
}
