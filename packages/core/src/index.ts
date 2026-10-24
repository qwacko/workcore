import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

export type Actor = { id: string; [key: string]: unknown };
export type Scope = { applicationId: string; workspaceId: string };
export type JsonSchema = Record<string, unknown>;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface WireCodec {
  /** Stable protocol identifier, negotiated per HTTP request. Reserve `json` for jsonWireCodec. */
  id: string;
  /** Must be deterministic and produce only JSONValue so queue/schedule adapters can persist it. */
  encode(value: unknown): JsonValue;
  /** Must restore values produced by this codec ID across client/server and worker deployments. */
  decode(value: JsonValue): unknown;
}

export const jsonWireCodec: WireCodec = {
  id: 'json',
  encode(value) { assertJsonValue(value); return value; },
  decode(value) { assertJsonValue(value); return value; },
};

function assertJsonValue(value: unknown, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new TypeError('JSON wire values cannot contain non-finite numbers');
  }
  if (typeof value !== 'object') throw new TypeError(`Unsupported JSON wire value: ${typeof value}`);
  if (seen.has(value)) throw new TypeError('JSON wire values cannot contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new TypeError('JSON wire arrays cannot be sparse');
      assertJsonValue(value[index], seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('JSON wire objects must be plain objects');
    for (const item of Object.values(value)) assertJsonValue(item, seen);
  }
  seen.delete(value);
}
export type OperationKind = 'query' | 'mutation' | 'task';
export type AgentToolKind = 'query' | 'mutation' | 'task';
export type ValidationSchema<I = unknown, O = I> = StandardSchemaV1<I, O>;
export type JsonSchemaProvider<I = unknown, O = I> = StandardJSONSchemaV1<I, O>;
export type AnySchema = {
  readonly '~standard': {
    readonly validate: (value: unknown, options?: { readonly libraryOptions?: Record<string, unknown> }) => unknown;
  };
};
export type InputOf<S> = S extends { readonly '~standard': { readonly types?: infer Types } }
  ? NonNullable<Types> extends { readonly input: infer Input } ? Input : never
  : never;
export type OutputOf<S> = S extends { readonly '~standard': { readonly types?: infer Types } }
  ? NonNullable<Types> extends { readonly output: infer Output } ? Output : never
  : never;

export type Permission<App, Input> =
  | string
  | readonly string[]
  | ((args: { actor: Actor; scope: Scope; input: Input; access: AccessControl<App> }) => boolean | Promise<boolean>);

export interface AccessControl<App = unknown> {
  has(capability: string): boolean | Promise<boolean>;
}

export type ExecutionContext<App> = {
  scope: Scope;
  actor: Actor;
  correlationId: string;
  signal: AbortSignal;
  services: ScopedServices;
  app: App;
  /** Incoming HTTP request metadata for interactive calls; absent for worker and scheduled executions. */
  request?: RequestContext;
};

/** Request metadata forwarded to synchronous operation handlers. Headers may contain credentials; never log or persist them. */
export type RequestContext = { url: string; method: string; headers: Headers };

export interface ScopedServices {
  kv: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  logger: Logger;
  tasks: { reportProgress(percent: number): Promise<void> };
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export type OperationCallContext<App, Input, Tools = OperationCaller> = {
  ctx: ExecutionContext<App>;
  input: Input;
  operations: Tools;
};

export type AuthorizationCheck<Auth = unknown> = (args: {
  auth: Auth;
  actor: Actor;
  scope: Scope;
  permission: string;
  input: unknown;
}) => boolean | Promise<boolean>;

export type AuthorizationDefinition<Auth = unknown> = {
  context: AnySchema;
  check: AuthorizationCheck<Auth>;
};

type AuthorizationConfiguration<ContextSchema extends AnySchema> = {
  context: ContextSchema;
  check: AuthorizationCheck<OutputOf<NoInfer<ContextSchema>>>;
};

export interface OperationCaller {
  query(name: string, input: unknown): Promise<unknown>;
  mutate(name: string, input: unknown): Promise<unknown>;
  enqueue(name: string, input: unknown): Promise<{ runId: string }>;
  enqueueAgent(name: string, input: unknown, options?: { conversationId?: string }): Promise<{ runId: string }>;
}

export type AgentTool = { kind: AgentToolKind; operation: string; description?: string };
export type AgentCallContext<App, Input> = {
  ctx: ExecutionContext<App>;
  input: Input;
  operations: OperationCaller;
};
export type AgentDefinition<App, S extends AnySchema = AnySchema> = {
  input: S;
  /** Increment when persisted handler-facing input becomes incompatible. Defaults to 1. */
  version?: number;
  permission?: Permission<App, OutputOf<S>>;
  tools: readonly AgentTool[];
  model: string;
  instructions: string | ((args: AgentCallContext<App, OutputOf<S>>) => string | Promise<string>);
  prompt: (args: AgentCallContext<App, OutputOf<S>>) => string | Promise<string>;
  /** A successful call to this declared tool terminates the run. */
  finishWhen: { tool: string };
  maxSteps?: number;
  maxOutputTokens?: number;
};

export interface OperationViewVariant {
  title: string;
  subtitle?: string;
  helpText?: string;
  renderer: 'table' | 'json' | 'chart' | 'form' | 'chat' | 'chat-messages' | 'chat-threads' | 'chat-thread';
  rowKey?: string;
  columns?: readonly string[];
  chart?: { xField: string; yField: string; seriesField?: string };
  /** Collection behavior attached to this query view; query views own their filters and editor. */
  collection?: CollectionViewOptions;
  actions?: readonly {
    label: string;
    mutation: string;
    variant?: string;
    bind?: Record<string, { fromRow: string }>;
  }[];
  layout?: Record<string, unknown>;
  chat?: {
    /** Omit composer settings for read-only chat/timeline views. */
    sendMutation?: string;
    messageInput?: string;
    conversationIdInput?: string;
    conversationQueryInput?: string;
    conversationIdPath?: string;
    conversationIdResultPath?: string;
    placeholder?: string;
    submitLabel?: string;
    rows?: number;
    /** Additional send-mutation inputs sourced from the current conversation/thread result. */
    inputBindings?: Record<string, { fromConversation: string } | { fromThread: string } | { value: JsonValue }>;
    /** Optional mutation mappings for standard chat actions. Execution and authorization remain normal mutations. */
    actions?: Record<string, ChatActionMapping>;
    autoScroll?: 'always' | 'when-near-bottom' | 'never';
  };
  /** Mutation mappings usable by message and thread list renderers without a composer. */
  chatActions?: Record<string, ChatActionMapping>;
  chatList?: { searchInput?: string; threadQuery?: string; threadIdInput?: string; detailVariant?: string };
}

export type ChatMessageStatus = { delivery?: 'pending' | 'sent' | 'failed'; visibility?: 'visible' | 'deleted' | 'hidden'; activity?: 'queued' | 'running' | 'complete' | 'interrupted' } & Record<string, JsonValue | undefined>;
export type ChatContentPart =
  | { id?: string; type: 'text'; text: string }
  | { id?: string; type: 'markdown'; content: string }
  | { id?: string; type: 'image'; url: string; alt?: string; mimeType?: string; data?: JsonValue }
  | { id?: string; type: 'file'; url: string; name: string; mimeType?: string; size?: number; data?: JsonValue }
  | { id?: string; type: 'link'; url: string; label?: string; data?: JsonValue }
  /** Navigate to a manifest-declared page and update only that page's declared string state. */
  | { id?: string; type: 'navigation'; page: string; label: string; state?: Record<string, string> }
  | { id?: string; type: 'tool'; name: string; state: 'input-available' | 'output-available' | 'output-error'; input?: JsonValue; output?: JsonValue }
  /** A named, authorized Workcore query/view; inputs are validated by that query. */
  | { id?: string; type: 'queryView'; query: string; view?: string; input?: JsonValue; title?: string }
  /** Declarative, versioned layout data; never executable code. */
  | { id?: string; type: 'customLayout'; version: number; layout: JsonValue; title?: string }
  | { id?: string; type: string; [key: string]: JsonValue | undefined };
export type ChatMessageSection = { id: string; title?: string; parts: ChatContentPart[]; data?: JsonValue };
export type ChatActor = { id: string; kind: 'person' | 'agent' | 'system' | string; name?: string; avatarUrl?: string; data?: JsonValue };
export type ChatMessage = {
  id: string;
  type?: string;
  threadId?: string;
  replyToMessageId?: string;
  sender?: ChatActor;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  createdAt?: string;
  editedAt?: string;
  preview?: string;
  status?: ChatMessageStatus | 'streaming' | 'complete' | 'interrupted' | 'failed';
  runId?: string;
  sections?: ChatMessageSection[];
  parts?: ChatContentPart[];
  actions?: ChatAction[];
  data?: JsonValue;
};

export type ChatAction = { id: string; label: string; input?: JsonValue; disabled?: boolean; disabledReason?: string; confirm?: string };
export type ChatActionMapping = { mutation: string; variant?: string; bind?: Record<string, { fromAction: string }> };
export type ChatThread = { id: string; title?: string; description?: string; status?: string; createdAt?: string; updatedAt?: string; participants?: ChatActor[]; lastMessage?: ChatMessage; messageCount?: number; unreadCount?: number; actions?: ChatAction[]; data?: JsonValue };
export type ChatPage<T, D = JsonValue> = { items: T[]; nextCursor: string | null; previousCursor?: string | null; totalCount?: number; data?: D };
export type ChatConversation = { id: string; title?: string; revision?: number; data?: JsonValue };
export type ChatMessagePage<D = JsonValue, C extends ChatConversation = ChatConversation> = ChatPage<ChatMessage, D> & {
  conversation?: C | null;
  thread?: ChatThread | null;
  activeRuns?: Array<{ runId: string; status: string }>;
};
export type ChatThreadPage<D = JsonValue> = ChatPage<ChatThread, D>;
export type ChatQueryResult<D = JsonValue, C extends ChatConversation = ChatConversation> = ChatMessagePage<D, C>;


export interface OperationViews {
  default: string;
  variants: Record<string, OperationViewVariant>;
}

export type AdminBlock =
  | { id: string; type: 'operation-catalog'; selection: string }
  | { id: string; type: 'operation-executor'; selection: string }
   | { id: string; type: 'query'; operation: string; variant?: string; input?: Record<string, unknown>; inputBindings?: Record<string, { state: string }> }
  | { id: string; type: 'mutation-form'; operation: string; variant?: string; title?: string }
  | { id: string; type: 'task-launcher'; operation: string; title?: string }
  | { id: string; type: 'custom'; component: string; version: number; title?: string; description?: string; props?: JsonValue }
  | { id: string; type: 'resource'; resource: 'tasks' | 'schedules' | 'history' | 'agents'; title?: string };

/** Renderer-independent collection behavior attached to an operation view. */
export interface CollectionViewOptions {
  itemKey: string;
  /** Field paths are dot-separated object keys with numeric array indices. */
  columns: readonly { field: string; label?: string; display?: 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'badge'; editable?: boolean | { targetInput: string }; filter?: { type: 'text' | 'select'; targetParam?: string } }[];
  titleField?: string;
  subtitleField?: string;
  /** Preferred layout for this named collection profile. */
  presentation?: 'responsive' | 'table' | 'cards';
  pagination?: boolean;
  /** Pagination contract used by the query behind this collection. */
  paginationMode?: 'cursor' | 'offset';
  editor?: { mutation: string; variant?: string; identity?: { rowField: string; targetInput: string } };
  /** Named mutations available from each row; these open the mutation's normal generated form. */
  actions?: readonly NonNullable<OperationViewVariant['actions']>[number][];
}

export type CollectionViewOptionsFor<Mutations extends object> = Omit<CollectionViewOptions, 'editor'> & {
  editor?: Omit<NonNullable<CollectionViewOptions['editor']>, 'mutation'> & { mutation: keyof Mutations & string };
  actions?: readonly UiActionFor<Mutations>[];
};

/** Permission-projected named operation presentations consumed by semantic renderers. */
export interface CompiledOperationPresentation extends OperationViews {
  operation: string;
  kind: OperationKind;
}

/** Canonical renderer-independent UI envelope for manifest protocol v2. */
export interface SemanticInterfaceDocument {
  version: 1;
  requiredFeatures: string[];
  pages: SemanticManifestPage[];
  defaultPage?: string;
  operationViews: CompiledOperationPresentation[];
}

export interface SemanticManifestPage extends Omit<AdminManifestPage, 'layout'> {
  layout?: 'stacked' | 'two-column' | 'overview' | 'page' | 'stack' | 'grid';
}

export interface AdminPage {
  title: string;
  description?: string;
  layout?: 'stacked' | 'two-column' | 'overview';
  /** Page-owned, JSON-safe state exposed as labelled controls and available to bound query inputs. */
  state?: Record<string, AdminPageState>;
  blocks: readonly AdminBlock[];
}

export type AdminPageState =
  | { type: 'text'; label: string; default: string }
  | { type: 'select'; label: string; default: string; options: readonly { value: string; label: string }[] };

export interface AdminConfiguration {
  builtins?: Partial<Record<'operations' | 'tasks' | 'schedules' | 'history' | 'agents', boolean>>;
  defaultPage?: string;
  pages?: Record<string, AdminPage>;
}

type AdminBlockFor<Queries extends string, Mutations extends string, Tasks extends string> =
  | { id: string; type: 'operation-catalog'; selection: string }
  | { id: string; type: 'operation-executor'; selection: string }
   | { id: string; type: 'query'; operation: Queries; variant?: string; input?: Record<string, unknown>; inputBindings?: Record<string, { state: string }> }
  | { id: string; type: 'mutation-form'; operation: Mutations; variant?: string; title?: string }
  | { id: string; type: 'task-launcher'; operation: Tasks; title?: string }
  | { id: string; type: 'custom'; component: string; version: number; title?: string; description?: string; props?: JsonValue }
  | { id: string; type: 'resource'; resource: 'tasks' | 'schedules' | 'history' | 'agents'; title?: string };

type AdminBlockForPage<Queries extends string, Mutations extends string, Tasks extends string, StateNames extends string> =
  | (Extract<AdminBlockFor<Queries, Mutations, Tasks>, { type: 'query' }> & { inputBindings?: Record<string, { state: StateNames }> })
  | Exclude<AdminBlockFor<Queries, Mutations, Tasks>, { type: 'query' }>;

type AdminConfigurationFor<Queries extends string, Mutations extends string, Tasks extends string> = Omit<AdminConfiguration, 'pages'> & {
  pages?: Record<string, Omit<AdminPage, 'blocks'> & { blocks: readonly AdminBlockFor<Queries, Mutations, Tasks>[] }>;
};

type SemanticQueries<Queries extends object, Mutations extends object, Tasks extends object> = {
  [Name in keyof Queries & string]: {
    view<const Bindings extends Record<string, { state: string }> = Record<never, never>>(variant: string, options: Omit<Extract<AdminBlockFor<keyof Queries & string, keyof Mutations & string, keyof Tasks & string>, { type: 'query' }>, 'type' | 'operation' | 'variant' | 'inputBindings'> & {
      id: string; variant?: string; input?: SchemaInput<Queries[Name]>;
      inputBindings?: Bindings;
    }): Omit<Extract<AdminBlockFor<keyof Queries & string, keyof Mutations & string, keyof Tasks & string>, { type: 'query' }>, 'inputBindings'> & { inputBindings?: Bindings };
  };
};
type SemanticAuthoredPage<Queries extends object, Mutations extends object, Tasks extends object, State extends Record<string, AdminPageState>> = Omit<AdminPage, 'blocks' | 'state'> & {
  state?: State;
  blocks: readonly AdminBlockForPage<keyof Queries & string, keyof Mutations & string, keyof Tasks & string, keyof State & string>[];
};

function createSemanticAdminContext<Queries extends object, Mutations extends object, Tasks extends object>(
  queryOperations: Partial<Record<keyof Queries & string, unknown>>,
  mutationOperations: Partial<Record<keyof Mutations & string, unknown>>,
  taskOperations: Partial<Record<keyof Tasks & string, unknown>>,
): SemanticAdminContext<Queries, Mutations, Tasks> {
  const queries = Object.fromEntries(Object.keys(queryOperations).map((name) => [name, {
    view: (variant: string, options: Record<string, unknown>) => ({ ...options, type: 'query' as const, operation: name, variant }),
  }])) as unknown as SemanticQueries<Queries, Mutations, Tasks>;
  const mutations = Object.fromEntries(Object.keys(mutationOperations).map((name) => [name, { name }])) as SemanticMutations<Mutations>;
  const tasks = Object.fromEntries(Object.keys(taskOperations).map((name) => [name, { name }])) as SemanticTasks<Tasks>;
  return { ui: {
    page: (page) => page,
    operationCatalog: (value) => ({ ...value, type: 'operation-catalog' as const }),
    operationExecutor: (value) => ({ ...value, type: 'operation-executor' as const }),
  }, queries, mutations, tasks };
}
type SemanticMutations<Mutations extends object> = { [Name in keyof Mutations & string]: { readonly name: Name } };
type SemanticTasks<Tasks extends object> = { [Name in keyof Tasks & string]: { readonly name: Name } };
export interface SemanticAdminContext<Queries extends object, Mutations extends object, Tasks extends object> {
  ui: {
    page<State extends Record<string, AdminPageState> = Record<never, never>>(page: SemanticAuthoredPage<Queries, Mutations, Tasks, State>): SemanticAuthoredPage<Queries, Mutations, Tasks, State>;
    operationCatalog(value: { id: string; selection: string }): Extract<AdminBlockFor<keyof Queries & string, keyof Mutations & string, keyof Tasks & string>, { type: 'operation-catalog' }>;
    operationExecutor(value: { id: string; selection: string }): Extract<AdminBlockFor<keyof Queries & string, keyof Mutations & string, keyof Tasks & string>, { type: 'operation-executor' }>;
  };
  queries: SemanticQueries<Queries, Mutations, Tasks>;
  mutations: SemanticMutations<Mutations>;
  tasks: SemanticTasks<Tasks>;
}
type AdminAuthoring<Queries extends object, Mutations extends object, Tasks extends object> = AdminConfigurationFor<keyof Queries & string, keyof Mutations & string, keyof Tasks & string>
  | ((context: SemanticAdminContext<Queries, Mutations, Tasks>) => AdminConfigurationFor<keyof Queries & string, keyof Mutations & string, keyof Tasks & string>);

export interface AdminManifestPage extends Omit<AdminPage, 'layout'> {
  layout?: AdminPage['layout'] | 'page' | 'stack' | 'grid';
  id: string;
  builtin?: boolean;
}

type CommonDefinition<App, S extends AnySchema, O extends AnySchema, Kind extends OperationKind, Tools = OperationCaller> = {
  input: S;
  output: O;
  version?: number;
  permission?: Permission<App, OutputOf<S>>;
  api?: boolean;
  views?: OperationViews;
  handler: (args: OperationCallContext<App, OutputOf<S>, Tools>) => InputOf<O> | Promise<InputOf<O>>;
  readonly kind?: Kind;
};

export type QueryDefinition<App, S extends AnySchema = AnySchema, O extends AnySchema = AnySchema, Tools = OperationCaller> = CommonDefinition<App, S, O, 'query', Tools> & { readonly kind: 'query' };
export type MutationDefinition<App, S extends AnySchema = AnySchema, O extends AnySchema = AnySchema, Tools = OperationCaller> = CommonDefinition<App, S, O, 'mutation', Tools> & { readonly kind: 'mutation' };
export type TaskDefinition<App, S extends AnySchema = AnySchema, O extends AnySchema = AnySchema, Tools = OperationCaller> = CommonDefinition<App, S, O, 'task', Tools> & {
  readonly kind: 'task';
  triggers?: { mutations?: readonly string[]; mapInput?: (event: WorkcoreEvent) => InputOf<S> };
};

export type DefinitionMap<App> = {
  id: string;
  admin?: AdminConfiguration;
  queries?: Record<string, QueryDefinition<App>>;
  mutations?: Record<string, MutationDefinition<App>>;
  tasks?: Record<string, TaskDefinition<App>>;
  agents?: Record<string, AgentDefinition<App>>;
};

export type WorkspaceDefinition<App, D extends { id: string } = { id: string }> = D & {
  readonly __appContext?: App;
  registerApplication(options: ApplicationRegistrationOptions<WorkspaceDefinition<App, D>>): ApplicationRegistration;
};

type SchemaArg<S extends AnySchema, O extends AnySchema> = { input: S; output: O };
type QueryOptions<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller> = SchemaArg<S, O> & Omit<CommonDefinition<App, S, O, 'query', Tools>, 'input' | 'output' | 'kind'>;
type MutationOptions<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller> = SchemaArg<S, O> & Omit<CommonDefinition<App, S, O, 'mutation', Tools>, 'input' | 'output' | 'kind'>;
type TaskOptions<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller> = SchemaArg<S, O> & Omit<CommonDefinition<App, S, O, 'task', Tools>, 'input' | 'output' | 'kind'> & { triggers?: { mutations?: readonly string[]; mapInput?: (event: WorkcoreEvent) => InputOf<S> } };
type AgentOptions<App, S extends AnySchema> = Omit<AgentDefinition<App, S>, 'input'> & { input: S };

type SchemaInput<S> = S extends AnySchema ? InputOf<S> : never;
type SchemaOutput<S> = S extends AnySchema ? OutputOf<S> : never;
type MutationSuccessEvent<Names extends string> = Omit<WorkcoreEvent, 'operation' | 'type'> & { type: 'mutation.succeeded'; operation: Names };
type AgentOperationTool<Queries extends object, Mutations extends object, Tasks extends object> =
  | { kind: 'query'; operation: keyof Queries & string; description?: string }
  | { kind: 'mutation'; operation: keyof Mutations & string; description?: string }
  | { kind: 'task'; operation: keyof Tasks & string; description?: string };
type AgentOperationToolName<Queries extends object, Mutations extends object, Tasks extends object> =
  | `query.${keyof Queries & string}`
  | `mutation.${keyof Mutations & string}`
  | `task.${keyof Tasks & string}`;
type AgentMap<App, Inputs extends object, Queries extends object, Mutations extends object, Tasks extends object> = {
  [K in keyof Inputs]: Omit<AgentDefinition<App, Inputs[K] extends AnySchema ? Inputs[K] : AnySchema>, 'tools' | 'finishWhen'> & {
    tools: readonly AgentOperationTool<Queries, Mutations, Tasks>[];
    finishWhen: { tool: AgentOperationToolName<Queries, Mutations, Tasks> };
  }
};
type UiActionFor<Mutations extends object> = {
  [Name in keyof Mutations & string]: Omit<NonNullable<OperationViewVariant['actions']>[number], 'mutation' | 'bind'> & {
    mutation: Name;
    bind?: SchemaInput<Mutations[Name]> extends object
      ? Partial<Record<keyof SchemaInput<Mutations[Name]> & string, { fromRow: string }>>
      : never;
  };
}[keyof Mutations & string];
type OperationViewVariantFor<Mutations extends object> = Omit<OperationViewVariant, 'actions' | 'collection'> & {
  actions?: readonly UiActionFor<Mutations>[];
  collection?: CollectionViewOptionsFor<Mutations>;
};
export type OperationViewsFor<Mutations extends object> = Omit<OperationViews, 'variants'> & {
  variants: Record<string, OperationViewVariantFor<Mutations>>;
};

type DefinitionOperationCaller<
  Queries extends object, QueryOutputs extends Record<keyof Queries, AnySchema>,
  Mutations extends object, MutationOutputs extends Record<keyof Mutations, AnySchema>,
  Tasks extends object, TaskOutputs extends Record<keyof Tasks, AnySchema>,
  Agents extends object,
> = {
  query<N extends keyof Queries & string>(name: N, input: SchemaInput<Queries[N]>): Promise<OutputOf<QueryOutputs[N]>>;
  mutate<N extends keyof Mutations & string>(name: N, input: SchemaInput<Mutations[N]>): Promise<OutputOf<MutationOutputs[N]>>;
  enqueue<N extends keyof Tasks & string>(name: N, input: SchemaInput<Tasks[N]>): Promise<{ runId: string }>;
  enqueueAgent<N extends keyof Agents & string>(name: N, input: SchemaInput<Agents[N]>, options?: { conversationId?: string }): Promise<{ runId: string }>;
};

type DefinitionOperationMap<
  App, Inputs extends object, Outputs extends Record<keyof Inputs, AnySchema>, Tools, Kind extends OperationKind, Mutations extends object,
> = {
  [K in keyof Inputs]: {
    input: Inputs[K];
    output: Outputs[K];
    version?: number;
    permission?: Permission<App, SchemaOutput<NoInfer<Inputs[K]>>>;
    api?: boolean;
    views?: OperationViewsFor<Mutations>;
    handler: (args: OperationCallContext<App, SchemaOutput<NoInfer<Inputs[K]>>, Tools>) => InputOf<NoInfer<Outputs[K]>> | Promise<InputOf<NoInfer<Outputs[K]>>>;
    readonly kind?: Kind;
  } & (Kind extends 'task' ? { triggers?: { mutations?: readonly (keyof Mutations & string)[]; mapInput?: (event: MutationSuccessEvent<keyof Mutations & string>) => SchemaInput<NoInfer<Inputs[K]>> } } : {});
} & {
  [K in keyof Outputs]: { output: Outputs[K] };
};

type DefinedOperationMap<
  App, Inputs extends object, Outputs extends Record<keyof Inputs, AnySchema>, Tools, Kind extends OperationKind, Mutations extends object,
> = {
  [K in keyof Inputs]: {
    input: Inputs[K];
    output: Outputs[K];
    version?: number;
    permission?: Permission<App, SchemaOutput<Inputs[K]>>;
    api?: boolean;
    views?: OperationViewsFor<Mutations>;
    handler: (args: OperationCallContext<App, SchemaOutput<Inputs[K]>, Tools>) => InputOf<Outputs[K]> | Promise<InputOf<Outputs[K]>>;
    readonly kind: Kind;
  } & (Kind extends 'task' ? { triggers?: { mutations?: readonly (keyof Mutations & string)[]; mapInput?: (event: MutationSuccessEvent<keyof Mutations & string>) => SchemaInput<Inputs[K]> } } : {});
};

type DefinedWorkspace<App, Id extends string,
  Queries extends object, QueryOutputs extends Record<keyof Queries, AnySchema>,
  Mutations extends object, MutationOutputs extends Record<keyof Mutations, AnySchema>,
  Tasks extends object, TaskOutputs extends Record<keyof Tasks, AnySchema>,
  Agents extends object,
  AuthSchema extends AnySchema | undefined,
> = {
  id: Id;
  admin?: AdminConfigurationFor<keyof Queries & string, keyof Mutations & string, keyof Tasks & string>;
  queries: DefinedOperationMap<App, Queries, QueryOutputs, DefinitionOperationCaller<Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, Agents>, 'query', Mutations>;
  mutations: DefinedOperationMap<App, Mutations, MutationOutputs, DefinitionOperationCaller<Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, Agents>, 'mutation', Mutations>;
  tasks: DefinedOperationMap<App, Tasks, TaskOutputs, DefinitionOperationCaller<Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, Agents>, 'task', Mutations>;
  agents: AgentMap<App, Agents, Queries, Mutations, Tasks>;
} & ([AuthSchema] extends [undefined]
  ? { authorization?: undefined }
  : AuthSchema extends AnySchema ? { authorization: AuthorizationConfiguration<AuthSchema> } : never);

type WorkspaceConfiguration<App, Id extends string,
  Queries extends object, QueryOutputs extends Record<keyof Queries, AnySchema>,
  Mutations extends object, MutationOutputs extends Record<keyof Mutations, AnySchema>,
  Tasks extends object, TaskOutputs extends Record<keyof Tasks, AnySchema>,
  Agents extends object,
  AuthSchema extends AnySchema | undefined,
> = {
  id: Id;
  admin?: AdminAuthoring<Queries, Mutations, Tasks>;
  authorization?: AuthSchema extends AnySchema ? AuthorizationConfiguration<AuthSchema> : undefined;
  queries?: DefinitionOperationMap<App, Queries, QueryOutputs, DefinitionOperationCaller<NoInfer<Queries>, NoInfer<QueryOutputs>, NoInfer<Mutations>, NoInfer<MutationOutputs>, NoInfer<Tasks>, NoInfer<TaskOutputs>, NoInfer<Agents>>, 'query', NoInfer<Mutations>>;
  mutations?: DefinitionOperationMap<App, Mutations, MutationOutputs, DefinitionOperationCaller<NoInfer<Queries>, NoInfer<QueryOutputs>, NoInfer<Mutations>, NoInfer<MutationOutputs>, NoInfer<Tasks>, NoInfer<TaskOutputs>, NoInfer<Agents>>, 'mutation', NoInfer<Mutations>>;
  tasks?: DefinitionOperationMap<App, Tasks, TaskOutputs, DefinitionOperationCaller<NoInfer<Queries>, NoInfer<QueryOutputs>, NoInfer<Mutations>, NoInfer<MutationOutputs>, NoInfer<Tasks>, NoInfer<TaskOutputs>, NoInfer<Agents>>, 'task', NoInfer<Mutations>>;
  agents?: AgentMap<App, Agents, Queries, Mutations, Tasks>;
};

function generatedCollectionView(inputSchema: AnySchema, outputSchema: AnySchema): CollectionViewOptions | undefined {
  const output = getJsonSchema(outputSchema, 'output');
  const outputProperties = output.properties && typeof output.properties === 'object' ? output.properties as Record<string, unknown> : {};
  const rows = outputProperties.rows as { type?: unknown; items?: { properties?: Record<string, unknown> } } | undefined;
  const input = getJsonSchema(inputSchema, 'input');
  const inputProperties = input.properties && typeof input.properties === 'object' ? input.properties as Record<string, { type?: unknown; enum?: unknown }> : {};
  const limit = inputProperties.limit as { type?: unknown; minimum?: unknown; maximum?: unknown } | undefined;
  const itemProperties = rows?.items?.properties;
  const cursorMode = !!outputProperties.nextCursor && inputProperties.cursor?.type === 'string';
  const offset = inputProperties.offset as { type?: unknown; minimum?: unknown } | undefined;
  const offsetMode = !!outputProperties.totalCount && offset?.type === 'integer' && typeof offset.minimum === 'number' && offset.minimum >= 0;
  if (rows?.type !== 'array' || !itemProperties?.id || (!cursorMode && !offsetMode) || !limit
    || !['integer', 'number'].includes(String(limit.type)) || typeof limit.minimum !== 'number' || limit.minimum < 1
    || typeof limit.maximum !== 'number' || limit.maximum < limit.minimum || limit.maximum > 200) return undefined;
  const required = (input.required as string[] | undefined) ?? [];
  const columns = Object.entries(itemProperties).flatMap(([field, rawSchema]) => {
    const schema = rawSchema as { type?: unknown; format?: unknown };
    if (!['string', 'number', 'integer', 'boolean'].includes(String(schema.type))) return [];
    const filter = inputProperties[field];
    const optional = !required.includes(field);
    return [{
      field,
      ...(schema.format === 'date-time' ? { display: 'datetime' as const } : schema.format === 'date' ? { display: 'date' as const } : schema.type === 'boolean' ? { display: 'boolean' as const } : schema.type === 'number' || schema.type === 'integer' ? { display: 'number' as const } : {}),
      ...(filter?.type === 'string' && optional ? { filter: { type: 'text' as const } } : filter && Array.isArray(filter.enum) && optional ? { filter: { type: 'select' as const } } : {}),
    }];
  });
  const title = columns.find((column) => column.field === 'title')
    ?? columns.find((column) => column.field !== 'id' && (itemProperties[column.field] as { type?: unknown }).type === 'string');
  return { itemKey: 'id', columns, ...(title ? { titleField: title.field } : {}), presentation: 'responsive', paginationMode: cursorMode ? 'cursor' : 'offset' };
}

function withOperationKind(operations: object | undefined, kind: OperationKind): Record<string, RuntimeOperation> {
  return Object.fromEntries(Object.entries(operations ?? {}).map(([name, operation]) => [name, { ...operation, kind }])) as Record<string, RuntimeOperation>;
}

function compileQueryViews(operations: object | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(operations ?? {}).map(([name, raw]) => {
    const operation = raw as { api?: boolean; input: AnySchema; output: AnySchema; views?: OperationViews };
    if (operation.api !== true) return [name, raw];
    const inferredCollection = generatedCollectionView(operation.input, operation.output);
    if (!operation.views) {
      return [name, { ...operation, views: inferredCollection
        ? { default: 'table', variants: { table: { title: name, renderer: 'table', rowKey: inferredCollection.itemKey, columns: inferredCollection.columns.map(({ field }) => field), collection: inferredCollection } } }
        : { default: 'json', variants: { json: { title: name, renderer: 'json' } } } }];
    }
    if (!inferredCollection) return [name, raw];
    const variants = Object.fromEntries(Object.entries(operation.views.variants).map(([variantName, variant]) => {
      if (variant.renderer !== 'table' || variant.collection) return [variantName, variant];
      const selectedFields = variant.columns;
      const collection = {
        ...inferredCollection,
        ...(variant.rowKey ? { itemKey: variant.rowKey } : {}),
        columns: selectedFields?.length ? inferredCollection.columns.filter(({ field }) => selectedFields.includes(field)) : inferredCollection.columns,
      };
      return [variantName, { ...variant, collection }];
    }));
    return [name, { ...operation, views: { ...operation.views, variants } }];
  }));
}

function assertSemanticJson(value: unknown, label: string, seen = new WeakSet<object>(), depth = 0): asserts value is JsonValue {
  if (depth > 64) throw new Error(`${label} exceeds the maximum JSON nesting depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object') throw new Error(`${label} must compile to strict JSON; found ${typeof value}`);
  if (seen.has(value)) throw new Error(`${label} must not contain cycles`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error(`${label} must contain only plain JSON objects`);
  seen.add(value);
  if (Array.isArray(value)) for (const child of value) assertSemanticJson(child, label, seen, depth + 1);
  else for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error(`${label} contains unsafe key '${key}'`);
    assertSemanticJson(child, label, seen, depth + 1);
  }
  seen.delete(value);
}

function schemaAtCollectionPath(root: unknown, path: string): Record<string, unknown> | undefined {
  const parts = path.split('.');
  if (!parts.length || parts.some((part) => !part || part === '__proto__' || part === 'prototype' || part === 'constructor')) return undefined;
  let current = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const schema = current as Record<string, unknown>;
    if (schema.type === 'array' && /^(0|[1-9]\d*)$/.test(part) && schema.items && typeof schema.items === 'object') {
      current = schema.items;
      continue;
    }
    const properties = schema.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties) || !Object.hasOwn(properties, part)) return undefined;
    current = (properties as Record<string, unknown>)[part];
  }
  return current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : undefined;
}

function validateCollectionActions(definition: RuntimeDefinition, actions: CollectionViewOptions['actions'] | undefined, rowSchema: unknown, label: string): void {
  for (const action of actions ?? []) {
    const mutation = definition.mutations?.[action.mutation];
    if (!action.label || !mutation || mutation.api !== true) throw new Error(`${label} references unavailable row action mutation '${action.mutation}'`);
    if (action.variant && !mutation.views?.variants[action.variant]) throw new Error(`${label} references unknown mutation view '${action.mutation}/${action.variant}'`);
    const mutationSchema = getJsonSchema(mutation.input, 'input');
    const inputs = mutationSchema.properties && typeof mutationSchema.properties === 'object' ? mutationSchema.properties as Record<string, { type?: unknown; format?: unknown }> : {};
    for (const [target, binding] of Object.entries(action.bind ?? {})) {
      const source = binding && schemaAtCollectionPath(rowSchema, binding.fromRow);
      const targetSchema = inputs[target];
      if (!targetSchema || !source) throw new Error(`${label} has an unresolved row action mapping '${binding?.fromRow} → ${target}'`);
      if (source.type !== targetSchema.type || (source.format && targetSchema.format && source.format !== targetSchema.format)) throw new Error(`${label} has an incompatible row action mapping '${binding.fromRow} → ${target}'`);
    }
  }
}

export function defineWorkspace<App>() {
  return <
    const Id extends string,
    const Queries extends object = {}, QueryOutputs extends Record<keyof Queries, AnySchema> = { [K in keyof Queries]: never },
    const Mutations extends object = {}, MutationOutputs extends Record<keyof Mutations, AnySchema> = { [K in keyof Mutations]: never },
    const Tasks extends object = {}, TaskOutputs extends Record<keyof Tasks, AnySchema> = { [K in keyof Tasks]: never },
    const Agents extends object = {},
    const AuthSchema extends AnySchema | undefined = undefined,
    const Authored extends { queries?: object; mutations?: object; tasks?: object } = {},
  >(definition: WorkspaceConfiguration<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, Agents, AuthSchema> & Authored): WorkspaceDefinition<App, DefinedWorkspace<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, Agents, AuthSchema>> & { readonly __publicOperations?: PublicCatalog<Authored> } => {
    const queryDefinitions = compileQueryViews(definition.queries);
    const queries = withOperationKind(queryDefinitions, 'query');
    const mutations = withOperationKind(definition.mutations, 'mutation');
    const tasks = withOperationKind(definition.tasks, 'task');
    const agents = definition.agents ?? {};
    const admin = typeof definition.admin === 'function'
      ? definition.admin(createSemanticAdminContext<Queries, Mutations, Tasks>(definition.queries ?? {}, definition.mutations ?? {}, definition.tasks ?? {}))
      : definition.admin;
    const runtimeDefinition: RuntimeDefinition = {
      id: definition.id,
      ...(admin === undefined ? {} : { admin }),
      ...(definition.authorization === undefined ? {} : { authorization: definition.authorization as AuthorizationDefinition }),
      queries,
      mutations,
      tasks: tasks as NonNullable<RuntimeDefinition['tasks']>,
      agents: agents as Record<string, RuntimeAgent>,
    };
    validateDefinition(runtimeDefinition);
    const workspace = { ...definition, admin, queries, mutations, tasks, agents };
    Object.defineProperty(workspace, 'registerApplication', {
      enumerable: false,
      value: (options: ApplicationRegistrationOptions<WorkspaceDefinition<App, DefinedWorkspace<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, Agents, AuthSchema>>>) => registerApplicationInternal<WorkspaceDefinition<App, DefinedWorkspace<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, Agents, AuthSchema>>>(runtimeDefinition, options),
    });
     return workspace as unknown as WorkspaceDefinition<App, DefinedWorkspace<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, Agents, AuthSchema>> & { readonly __publicOperations?: PublicCatalog<Authored> };
  };
}

/** Preferred name: defines an application catalog, not a scoped workspace instance. */
export const defineApplication = defineWorkspace;

export { composeApplication, defineModule, type ComposedOperationCaller, type ModuleDefinition } from './composition.js';

export function query<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: QueryOptions<App, S, O, Tools>): QueryDefinition<App, S, O, Tools> {
  return { ...options, kind: 'query' };
}
type RendererMetadata<R extends OperationViewVariant['renderer']> = { default: string; variants: Record<string, Omit<OperationViewVariant, 'renderer'> & { renderer: R }> };
type QueryWithOutput<App, S extends AnySchema, O extends AnySchema, Tools, RequiredOutput, Renderer extends OperationViewVariant['renderer']> = Omit<QueryOptions<App, S, O, Tools>, 'views'> & { views?: RendererMetadata<Renderer> } & (OutputOf<O> extends RequiredOutput ? unknown : never);
export type CursorTablePage<Row> = { rows: Row[]; nextCursor: string | null };
export type OffsetTablePage<Row> = { rows: Row[]; totalCount: number };
export function cursorTableQuery<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: Omit<QueryOptions<App, S, O, Tools>, 'views'> & (OutputOf<O> extends CursorTablePage<unknown> ? unknown : never)): Omit<QueryDefinition<App, S, O, Tools>, 'views'> & { readonly kind: 'query' } {
  return { ...options, kind: 'query' };
}
export function offsetTableQuery<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: Omit<QueryOptions<App, S, O, Tools>, 'views'> & (OutputOf<O> extends OffsetTablePage<unknown> ? unknown : never)): Omit<QueryDefinition<App, S, O, Tools>, 'views'> & { readonly kind: 'query' } {
  return { ...options, kind: 'query' };
}
/** Typed query-definition conveniences. They share the ordinary query execution and validation pipeline. */
export function chatMessageQuery<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: QueryWithOutput<App, S, O, Tools, { items: unknown[]; nextCursor: string | null }, 'chat' | 'chat-messages' | 'chat-thread' | 'json'>): QueryDefinition<App, S, O, Tools> { return { ...options, kind: 'query' }; }
export function chatThreadQuery<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: QueryWithOutput<App, S, O, Tools, { items: unknown[]; nextCursor: string | null }, 'chat-threads' | 'json'>): QueryDefinition<App, S, O, Tools> { return { ...options, kind: 'query' }; }
export function mutation<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: MutationOptions<App, S, O, Tools>): MutationDefinition<App, S, O, Tools> {
  return { ...options, kind: 'mutation' };
}
export function task<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: TaskOptions<App, S, O, Tools>): TaskDefinition<App, S, O, Tools> {
  return { ...options, kind: 'task' };
}
export function agent<App, S extends AnySchema>(options: AgentOptions<App, S>): AgentDefinition<App, S> { return options; }

type OperationsFor<D, K extends OperationKind> = K extends 'query'
  ? D extends { queries?: infer Q } ? NonNullable<Q> : {}
  : K extends 'mutation'
    ? D extends { mutations?: infer M } ? NonNullable<M> : {}
    : D extends { tasks?: infer T } ? NonNullable<T> : {};
export type QueryNames<D> = keyof OperationsFor<D, 'query'> & string;
export type MutationNames<D> = keyof OperationsFor<D, 'mutation'> & string;
export type TaskNames<D> = keyof OperationsFor<D, 'task'> & string;
type PublicNames<D, K extends OperationKind> = {
  [N in keyof OperationsFor<D, K>]: OperationsFor<D, K>[N] extends { api?: infer Exposure } ? true extends Exposure ? N : never : never;
}[keyof OperationsFor<D, K>] & string;
type PublicCatalog<D> = { [K in OperationKind]: PublicNames<D, K> };
export type PublicOperationNames<D, K extends OperationKind> = D extends { readonly __publicOperations?: infer Catalog }
  ? Catalog extends Record<OperationKind, string> ? Catalog[K] : never
  : PublicNames<D, K>;
export type DefinitionAt<D, K extends OperationKind, N extends string> = N extends keyof OperationsFor<D, K> ? OperationsFor<D, K>[N] : never;

export type InputFor<Def> = Def extends { input: infer S } ? InputOf<S> : never;
export type OutputFor<Def> = Def extends { output: infer S } ? OutputOf<S> : never;

export type RuntimeDefinition = {
  id: string;
  admin?: AdminConfiguration;
  authorization?: AuthorizationDefinition;
  queries?: Record<string, RuntimeOperation>;
  mutations?: Record<string, RuntimeOperation>;
  tasks?: Record<string, RuntimeOperation & { triggers?: { mutations?: readonly string[]; mapInput?: (event: WorkcoreEvent) => unknown } }>;
  agents?: Record<string, RuntimeAgent>;
};

export type RuntimeAgent = Omit<AgentDefinition<unknown, AnySchema>, 'permission' | 'instructions' | 'prompt'> & {
  permission?: Permission<unknown, unknown>;
  instructions: string | ((args: AgentCallContext<unknown, unknown>) => string | Promise<string>);
  prompt: (args: AgentCallContext<unknown, unknown>) => string | Promise<string>;
};

export type RuntimeOperation = {
  kind: OperationKind;
  version?: number;
  input: AnySchema;
  output: AnySchema;
  permission?: Permission<unknown, unknown>;
  api?: boolean;
  views?: OperationViews;
  handler: (args: OperationCallContext<unknown, unknown>) => unknown | Promise<unknown>;
};

declare const registeredApplicationBrand: unique symbol;

/** Context-erased application value accepted by createPlatform. Construct it with definition.registerApplication(). */
export type ApplicationRegistration = {
  readonly [registeredApplicationBrand]: true;
  readonly definition: RuntimeDefinition;
  readonly createAppContext: (args: { scope: Scope; actor: Actor }) => unknown | Promise<unknown>;
  readonly resolveAuthorization?: (args: { scope: Scope; actor: Actor }) => unknown | Promise<unknown>;
};

type DefinitionWithContext = { id: string; readonly __appContext?: unknown };
type ContextFromDefinition<D> = D extends { readonly __appContext?: infer App } ? Exclude<App, undefined> : never;
type AuthorizationFromDefinition<D> = D extends { authorization?: { context: infer S } }
  ? S extends AnySchema ? OutputOf<S> : never
  : never;
type AuthorizationRegistrationOption<D extends DefinitionWithContext> = D extends { authorization: { context: infer S } }
  ? { resolveAuthorization: (args: { scope: Scope; actor: Actor }) => (S extends AnySchema ? InputOf<S> : never) | Promise<S extends AnySchema ? InputOf<S> : never> }
  : { resolveAuthorization?: (args: { scope: Scope; actor: Actor }) => unknown | Promise<unknown> };

export type ApplicationRegistrationOptions<D extends DefinitionWithContext> = {
  createAppContext: (args: { scope: Scope; actor: Actor }) => ContextFromDefinition<D> | Promise<ContextFromDefinition<D>>;
} & AuthorizationRegistrationOption<D>;

/**
 * Bind an application's definition to its context factory. The context type is inferred from
 * defineWorkspace<App>() and checked here, then erased at the heterogeneous platform registry.
 */
function registerApplicationInternal<const D extends DefinitionWithContext>(definition: RuntimeDefinition, registration: ApplicationRegistrationOptions<D>): ApplicationRegistration {
  return Object.freeze({
    definition,
    createAppContext: registration.createAppContext,
    ...(registration.resolveAuthorization ? { resolveAuthorization: registration.resolveAuthorization } : {}),
  }) as ApplicationRegistration;
}

export interface AuthAdapter {
  authenticate(request: Request): Actor | null | Promise<Actor | null>;
  resolveActor?(actorId: string): Actor | null | Promise<Actor | null>;
}

export interface WorkspaceAdapter {
  canAccess(actor: Actor, scope: Scope): boolean | Promise<boolean>;
  list(actor: Actor, applicationId: string): Promise<Array<{ id: string; name: string }>>;
}

export type WorkcoreEvent = {
  id: string;
  type: 'mutation.succeeded' | 'task.succeeded' | 'task.failed' | 'workspace.invalidated';
  applicationId: string;
  workspaceId: string;
  operation?: string;
  executionId: string;
  actorId: string;
  correlationId: string;
  causationId?: string;
  triggerDepth?: number;
  createdAt: string;
};

export interface EventAdapter {
  publish(event: WorkcoreEvent): Promise<void>;
  subscribe(scope: Scope, listener: (event: WorkcoreEvent) => void): () => void;
}

export type HistoryEntry = {
  id: string;
  scope: Scope;
  actorId: string;
  kind: OperationKind | 'schedule';
  operation: string;
  status: 'succeeded' | 'failed' | 'delivery_failed' | 'queued' | 'running';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: { code: string; message: string };
  runId?: string;
};

export interface HistoryAdapter {
  append(entry: HistoryEntry): Promise<void>;
  list(scope: Scope, limit: number): Promise<HistoryEntry[]>;
}

export type TaskPayload = {
  id: string;
  applicationId: string;
  workspaceId: string;
  operation: string;
  /** Missing legacy versions mean 1. */
  operationVersion?: number;
  /** Encoded, already-validated handler input. Decode with codecId; do not validate as raw schema input again. */
  input: JsonValue;
  codecId?: string;
  actorId: string;
  correlationId: string;
  causationId?: string;
  scheduleId?: string;
  triggerDepth?: number;
  createdAt: string;
};

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';
export type AgentRun = {
  id: string;
  scope: Scope;
  actorId: string;
  agent: string;
  status: AgentRunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  finishReason?: string;
  result?: JsonValue;
  error?: { code: string; message: string };
  correlationId: string;
  conversationId?: string;
  codecId?: string;
};
export type AgentTraceEvent = {
  id: string;
  runId: string;
  sequence: number;
  createdAt: string;
  type: 'run.started' | 'step.started' | 'step.completed' | 'tool.started' | 'tool.completed' | 'tool.failed' | 'run.completed' | 'run.failed';
  data?: JsonValue;
};
export interface AgentRunAdapter {
  create(run: AgentRun): Promise<void>;
  get(scope: Scope, runId: string): Promise<AgentRun | undefined>;
  list(scope: Scope, filter: { limit: number; cursor?: string; agent?: string; status?: AgentRunStatus; actorId?: string; conversationId?: string }): Promise<{ runs: AgentRun[]; nextCursor: string | null }>;
  update(run: AgentRun): Promise<void>;
  appendEvent(event: AgentTraceEvent): Promise<void>;
  listEvents(scope: Scope, runId: string, afterSequence: number, limit: number): Promise<AgentTraceEvent[]>;
}

export type AgentToolExecutor = (input: unknown, signal?: AbortSignal) => Promise<unknown>;
export type AgentEngine = {
  run(args: {
    model: string;
    instructions: string;
    prompt: string;
    maxSteps: number;
    maxOutputTokens?: number;
    tools: Record<string, { description?: string; inputSchema: JsonSchema; execute: AgentToolExecutor }>;
    finishTool: string;
    signal: AbortSignal;
    onEvent: (event: Omit<AgentTraceEvent, 'id' | 'runId' | 'sequence' | 'createdAt'>) => Promise<void>;
  }): Promise<{ finishReason: string; finishTool?: string }>;
};

export type TaskRun = HistoryEntry & { kind: 'task'; runId: string; progress?: number; result?: JsonValue; codecId?: string };
export interface TaskAdapter {
  /** Idempotent by payload.id, including completed runs retained for schedule recovery. */
  enqueue(payload: TaskPayload): Promise<void>;
  claim(): Promise<TaskPayload | undefined>;
  /** Extend a claimed task lease while its handler is executing, when the adapter uses expiring claims. */
  heartbeat?(runId: string): Promise<void>;
  /** Return a claimed run to the queue after a transient worker/adapter failure. */
  release(runId: string): Promise<void>;
  complete(runId: string, result: JsonValue): Promise<void>;
  fail(runId: string, error: { code: string; message: string }): Promise<void>;
  progress(runId: string, percent: number): Promise<void>;
  list(scope: Scope, limit: number): Promise<TaskRun[]>;
  waitForWork(signal: AbortSignal): Promise<void>;
}

export interface ScheduleEntry {
  id: string;
  scope: Scope;
  operation: string;
  operationVersion?: number;
  /** Encoded, already-validated handler input. Decode with codecId when the schedule is due. */
  input: JsonValue;
  codecId?: string;
  actorId: string;
  timezone: string;
  kind: 'once' | 'recurring';
  runAt?: string;
  cron?: string;
  enabled: boolean;
  nextRunAt?: string;
  createdAt: string;
  lastSkipReason?: string;
  activeRunId?: string;
  /** Compare-and-set version; absent legacy values mean zero. */
  revision?: number;
  /** Durable dispatch reservation, retained until enqueue and bookkeeping finish. */
  pendingRunId?: string;
  /** Internal durable polling reservation. Adapters must persist these fields atomically. */
  claimToken?: string;
  claimUntil?: string;
}

export interface ScheduleAdapter {
  create(schedule: ScheduleEntry): Promise<void>;
  list(scope: Scope): Promise<ScheduleEntry[]>;
  get(id: string): Promise<ScheduleEntry | undefined>;
  /** Compare-and-set revision, preserving current claim/dispatch fields. Increment on success. */
  update(schedule: ScheduleEntry): Promise<boolean>;
  remove(id: string): Promise<void>;
  /** Atomically reserves due schedules across all processes; never implements claims as a short nextRunAt delay. */
  claimDue(now: Date, claimToken: string, leaseMs: number): Promise<ScheduleEntry[]>;
  /** Claim operations must be atomic; claimed updates/removal also compare the snapshot revision. */
  renewClaim(id: string, claimToken: string, claimUntil: string): Promise<boolean>;
  /** Atomically check claim, revision and enabled state, then persist the run ID before enqueue. */
  reserveRun(schedule: ScheduleEntry, claimToken: string, runId: string): Promise<boolean>;
  /** Clear only the matching active run, without replacing schedule fields. */
  clearActiveRun(id: string, runId: string): Promise<void>;
  updateClaimed(schedule: ScheduleEntry, claimToken: string): Promise<boolean>;
  removeClaimed(id: string, claimToken: string, revision?: number): Promise<boolean>;
  releaseClaim(id: string, claimToken: string): Promise<void>;
}

export interface KeyValueAdapter {
  get(scope: Scope, key: string): Promise<unknown | undefined>;
  set(scope: Scope, key: string, value: unknown): Promise<void>;
  delete(scope: Scope, key: string): Promise<void>;
}

export type PlatformServices = {
  workspaces: WorkspaceAdapter;
  events: EventAdapter;
  history: HistoryAdapter;
  tasks: TaskAdapter;
  schedules: ScheduleAdapter;
  kv: KeyValueAdapter;
  agentRuns?: AgentRunAdapter;
  agentEngine?: AgentEngine;
  logger?: Logger;
};

export type PlatformOptions = {
  applications: readonly ApplicationRegistration[];
  auth: AuthAdapter;
  services: PlatformServices;
  authorise?: (args: { actor: Actor; scope: Scope; permission: string; input: unknown }) => boolean | Promise<boolean>;
  /** Additional exact browser origins trusted behind a reverse proxy. */
  trustedOrigins?: readonly string[];
  admin?: { basePath: string; handle?: (request: Request) => Promise<Response> | Response };
  maxRequestBytes?: number;
  maxResultBytes?: number;
  /** Maximum handler runtime. Defaults to 30 seconds for HTTP/internal calls and 5 minutes for worker tasks. */
  operationTimeoutMs?: number;
  /** Interactive/internal handler deadline; overrides operationTimeoutMs. */
  interactiveTimeoutMs?: number;
  /** Worker task/agent handler deadline; overrides operationTimeoutMs. */
  backgroundTimeoutMs?: number;
  /** Maximum time worker.stop() waits after aborting work. Defaults to 10 seconds. */
  shutdownTimeoutMs?: number;
  liveRefreshMs?: number;
  workerRetryDelayMs?: number;
  /** Additional allow-listed codecs for request/response values and encoded queue/schedule inputs. */
  wireCodecs?: readonly WireCodec[];
};

export function createPlatform(options: PlatformOptions) {
  for (const name of ['maxRequestBytes', 'maxResultBytes', 'operationTimeoutMs', 'interactiveTimeoutMs', 'backgroundTimeoutMs', 'liveRefreshMs', 'workerRetryDelayMs', 'shutdownTimeoutMs'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (name === 'shutdownTimeoutMs' ? 0 : 1) || (name.endsWith('Ms') && value > 2_147_483_647))) throw new RangeError(`${name} must be a ${name === 'shutdownTimeoutMs' ? 'non-negative' : 'positive'} safe integer within the supported range`);
  }
  const apps = new Map(options.applications.map((registration) => [registration.definition.id, registration]));
  const trustedOrigins = new Set((options.trustedOrigins ?? []).map(normalizeOrigin));
  const codecs = new Set<string>();
  for (const codec of options.wireCodecs ?? []) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(codec.id) || codec.id === jsonWireCodec.id || codecs.has(codec.id)) throw new Error(`Invalid or duplicate wire codec id '${codec.id}'`);
    codecs.add(codec.id);
  }
  if (apps.size !== options.applications.length) throw new Error('Application IDs must be unique');
  for (const registration of options.applications) validateDefinition(registration.definition);

  const worker = () => {
    if (!options.auth.resolveActor) throw new Error('Background workers require auth.resolveActor');
    return createWorker(options, apps);
  };
  const httpHandler = (mount: { apiBasePath?: string; admin?: { basePath: string; handle?: (request: Request) => Promise<Response> | Response } } = {}) => {
    const apiBasePath = normalizePath(mount.apiBasePath ?? '/workcore/api');
    const admin = mount.admin ?? options.admin;
    const adminPath = admin ? normalizePath(admin.basePath) : undefined;
    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (adminPath && (url.pathname === adminPath || url.pathname.startsWith(`${adminPath}/`))) {
        if (admin?.handle) return admin.handle(request);
        return json({ error: { code: 'ADMIN_ASSETS_NOT_CONFIGURED', message: 'Install @workcore/admin and provide its createAdminHandler() for this route' } }, 501);
      }
      if (!url.pathname.startsWith(`${apiBasePath}/`) && url.pathname !== apiBasePath) return new Response('Not found', { status: 404 });
      let codec = jsonWireCodec;
      const correlationId = request.headers.get('x-correlation-id')?.slice(0, 128) || randomId();
      request = new Request(request, { headers: new Headers(request.headers) });
      request.headers.set('x-correlation-id', correlationId);
      try {
        codec = resolveWireCodec(options, request.headers.get('x-workcore-codec'));
        const response = await handleApi(request, url, apiBasePath, options, apps, trustedOrigins, codec);
        response.headers.set('x-correlation-id', correlationId);
        return withCorsHeaders(response, request, trustedOrigins);
      } catch (error) {
        const known = error instanceof WorkcoreError ? error : new WorkcoreError('INTERNAL_ERROR', 'The operation could not be completed', 500);
        options.services.logger?.error('Workcore request failed', { code: known.code, correlationId, detail: error instanceof Error ? error.message : String(error) });
        const responseCodec = known.code === 'WIRE_CODEC_UNSUPPORTED' ? jsonWireCodec : codec;
        const headers = { 'x-correlation-id': correlationId };
        try { return withCorsHeaders(json({ error: { code: known.code, message: known.message, correlationId, ...(known.issues ? { issues: known.issues } : {}) } }, known.status, headers, responseCodec), request, trustedOrigins); }
        catch { return withCorsHeaders(json({ error: { code: 'WIRE_ENCODING_FAILED', message: 'The error response could not be encoded', correlationId } }, 500, headers), request, trustedOrigins); }
      }
    };
  };
  return { httpHandler, worker };
}

export type ValidationIssue = { message: string; path?: Array<string | number> };

class WorkcoreError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly issues?: ValidationIssue[]) { super(message); }
}

function json(value: unknown, status = 200, headers: HeadersInit = {}, codec: WireCodec = jsonWireCodec) {
  const encoded = encodeWithCodec(codec, value);
  const body = codec.id === 'json' ? encoded : { workcoreCodec: codec.id, payload: encoded };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function encodeWithCodec(codec: WireCodec, value: unknown): JsonValue {
  try {
    const encoded = codec.encode(value);
    assertJsonValue(encoded);
    return encoded;
  }
  catch (error) {
    const detail = error instanceof TypeError ? error.message : safeMessage(error);
    throw new WorkcoreError('WIRE_ENCODING_FAILED', `Could not encode value with '${codec.id}': ${detail}`, 422);
  }
}

function decodeWithCodec(codec: WireCodec, value: JsonValue): unknown {
  try { return codec.decode(value); }
  catch (error) {
    const detail = error instanceof TypeError ? error.message : safeMessage(error);
    throw new WorkcoreError('WIRE_DECODING_FAILED', `Could not decode value with '${codec.id}': ${detail}`, 400);
  }
}

function decodeStored(value: JsonValue, codecId: string | undefined, options: PlatformOptions) {
  return decodeWithCodec(resolveWireCodec(options, codecId ?? 'json'), value);
}

function publicSchedule(schedule: ScheduleEntry, options: PlatformOptions) {
  const { claimToken: _claimToken, claimUntil: _claimUntil, pendingRunId: _pendingRunId, ...publicFields } = schedule;
  return { ...publicFields, input: decodeStored(schedule.input, schedule.codecId, options) };
}

function resolveWireCodec(options: PlatformOptions, requestedId: string | null): WireCodec {
  if (!requestedId || requestedId === 'json') return jsonWireCodec;
  const codec = options.wireCodecs?.find((candidate) => candidate.id === requestedId);
  if (!codec) throw new WorkcoreError('WIRE_CODEC_UNSUPPORTED', `Wire codec '${requestedId}' is not supported`, 406);
  return codec;
}

async function decodeRequestEnvelope(requestValue: unknown, codec: WireCodec): Promise<Record<string, unknown>> {
  if (codec.id === 'json') {
    if (!requestValue || typeof requestValue !== 'object' || Array.isArray(requestValue)) throw new WorkcoreError('INVALID_REQUEST', 'Request body must be an object', 400);
    return requestValue as Record<string, unknown>;
  }
  if (!requestValue || typeof requestValue !== 'object' || Array.isArray(requestValue)) throw new WorkcoreError('INVALID_REQUEST', 'Encoded request body must be an object', 400);
  const envelope = requestValue as Record<string, unknown>;
  if (Object.keys(envelope).length === 0) return {};
  if (envelope.workcoreCodec !== codec.id || !('payload' in envelope)) throw new WorkcoreError('WIRE_CODEC_MISMATCH', 'Request codec header and body do not match', 400);
  const decoded = decodeWithCodec(codec, envelope.payload as JsonValue);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new WorkcoreError('INVALID_REQUEST', 'Decoded request body must be an object', 400);
  return decoded as Record<string, unknown>;
}

async function handleApi(request: Request, url: URL, base: string, options: PlatformOptions, apps: Map<string, ApplicationRegistration>, trustedOrigins: ReadonlySet<string>, codec: WireCodec) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, trustedOrigins) });
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') throw new WorkcoreError('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && request.method !== 'GET' && requestOrigin !== url.origin && !trustedOrigins.has(requestOrigin)) {
    throw new WorkcoreError('CSRF_REJECTED', 'Cross-origin request rejected', 403);
  }
  const actor = await options.auth.authenticate(request);
  if (!actor) throw new WorkcoreError('UNAUTHENTICATED', 'Authentication required', 401);
  const path = url.pathname.slice(base.length).replace(/^\//, '');
  if (path === 'workspaces' && request.method === 'GET') {
    const applicationId = url.searchParams.get('applicationId') ?? '';
    if (!apps.has(applicationId)) throw new WorkcoreError('APPLICATION_NOT_FOUND', 'Unknown application', 404);
    const list = await options.services.workspaces.list(actor, applicationId);
    return json({ workspaces: list }, 200, {}, codec);
  }
  const parsedBody = request.method === 'POST' || request.method === 'PATCH' ? await readBody(request, options.maxRequestBytes ?? 1_048_576) : {};
  const body = await decodeRequestEnvelope(parsedBody, codec);
  if (path === 'applications' && request.method === 'GET') {
    const applications = [];
    for (const applicationId of apps.keys()) {
      const workspaces = await options.services.workspaces.list(actor, applicationId);
      if (workspaces.length) applications.push({ id: applicationId, workspaceCount: workspaces.length });
    }
    return json({ applications }, 200, {}, codec);
  }
  const applicationId = String((body as Record<string, unknown>).applicationId ?? url.searchParams.get('applicationId') ?? '');
  const workspaceId = String((body as Record<string, unknown>).workspaceId ?? url.searchParams.get('workspaceId') ?? '');
  const scope = { applicationId, workspaceId };
  const registration = apps.get(applicationId);
  if (!registration) throw new WorkcoreError('APPLICATION_NOT_FOUND', 'Unknown application', 404);
  if (!workspaceId) throw new WorkcoreError('WORKSPACE_REQUIRED', 'A workspace must be selected', 400);
  if (!await options.services.workspaces.canAccess(actor, scope)) throw new WorkcoreError('FORBIDDEN', 'Workspace access denied', 403);
  const input = (body as Record<string, unknown>).input;
  if (path === 'manifest' && request.method === 'GET') return json(await makeManifest(registration, actor, scope, options), 200, {}, codec);
  if (path === 'events' && request.method === 'GET') return eventStream(request, scope, actor, registration, options, apps, trustedOrigins);
  if (path === 'history' && request.method === 'GET') {
    if (!await canCapability(registration, options, actor, scope, 'workcore.history.read', undefined)) throw new WorkcoreError('FORBIDDEN', 'History access denied', 403);
    return json({ entries: await options.services.history.list(scope, boundedLimit(url.searchParams.get('limit'))) }, 200, {}, codec);
  }
  if (path === 'tasks' && request.method === 'GET') {
    if (!await canCapability(registration, options, actor, scope, 'workcore.tasks.read', undefined)) throw new WorkcoreError('FORBIDDEN', 'Task access denied', 403);
    const runs = await options.services.tasks.list(scope, boundedLimit(url.searchParams.get('limit')));
    return json({ runs: runs.filter((run) => !run.operation.startsWith('@workcore/agent/')).map((run) => ({ ...run, ...(run.result === undefined ? {} : { result: decodeStored(run.result, run.codecId, options) }) })) }, 200, {}, codec);
  }
  if ((path === 'agent-runs' || path.startsWith('agent-runs/')) && request.method === 'GET') {
    if (!options.services.agentRuns) throw new WorkcoreError('AGENT_STORAGE_UNAVAILABLE', 'Agent run storage is not configured', 503);
    if (!await canCapability(registration, options, actor, scope, 'workcore.agents.runs.read', undefined)) throw new WorkcoreError('FORBIDDEN', 'Agent run access denied', 403);
    if (path === 'agent-runs') {
      const status = url.searchParams.get('status') ?? undefined;
      if (status && !isAgentRunStatus(status)) throw new WorkcoreError('INVALID_FILTER', 'Unknown agent run status', 400);
      const filter = {
        limit: boundedLimit(url.searchParams.get('limit')),
        ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor')! } : {}),
        ...(url.searchParams.get('agent') ? { agent: url.searchParams.get('agent')! } : {}),
        ...(isAgentRunStatus(status) ? { status } : {}),
        ...(url.searchParams.get('actorId') ? { actorId: url.searchParams.get('actorId')! } : {}),
        ...(url.searchParams.get('conversationId') ? { conversationId: url.searchParams.get('conversationId')! } : {}),
      };
      const canReadAll = await canCapability(registration, options, actor, scope, 'workcore.agents.runs.read.all', undefined);
      if (!canReadAll) filter.actorId = actor.id;
      let result: Awaited<ReturnType<AgentRunAdapter['list']>>;
      try { result = await options.services.agentRuns.list(scope, filter); }
      catch (error) { if (error instanceof TypeError) throw new WorkcoreError('INVALID_CURSOR', 'Agent run cursor is invalid', 400); throw error; }
      return json({ ...result, runs: await Promise.all(result.runs.map((run) => projectAgentRun(run, registration, actor, scope, options))) }, 200, {}, codec);
    }
    const [runId, resource] = path.slice('agent-runs/'.length).split('/');
    const run = await options.services.agentRuns.get(scope, decodeURIComponent(runId ?? ''));
    if (!run) throw new WorkcoreError('NOT_FOUND', 'Agent run not found', 404);
    const canReadAll = await canCapability(registration, options, actor, scope, 'workcore.agents.runs.read.all', undefined);
    if (!canReadAll && run.actorId !== actor.id) throw new WorkcoreError('NOT_FOUND', 'Agent run not found', 404);
    const projected = await projectAgentRun(run, registration, actor, scope, options);
    if (!resource) return json({ run: projected }, 200, {}, codec);
    if (resource !== 'events') throw new WorkcoreError('NOT_FOUND', 'Agent run resource not found', 404);
    const events = await options.services.agentRuns.listEvents(scope, run.id, Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0), boundedLimit(url.searchParams.get('limit')));
    const canReadTools = await canCapability(registration, options, actor, scope, 'workcore.agents.tools.read', undefined);
    const canReadPayloads = await canCapability(registration, options, actor, scope, 'workcore.agents.toolPayloads.read', undefined);
    const canReadMessages = await canCapability(registration, options, actor, scope, 'workcore.agents.messages.read', undefined);
    return json({ events: events.map((event) => projectAgentEvent(event, { canReadTools, canReadPayloads, canReadMessages })), nextCursor: events.length === boundedLimit(url.searchParams.get('limit')) ? String(events.at(-1)!.sequence) : null }, 200, {}, codec);
  }
  if (path === 'schedules' && request.method === 'GET') {
    if (!await canCapability(registration, options, actor, scope, 'workcore.schedules.read', undefined)) throw new WorkcoreError('FORBIDDEN', 'Schedule access denied', 403);
    const schedules = await options.services.schedules.list(scope);
    return json({ schedules: schedules.map((schedule) => publicSchedule(schedule, options)) }, 200, {}, codec);
  }
  if (path === 'schedules' && request.method === 'POST') {
    if (!await canCapability(registration, options, actor, scope, 'workcore.schedules.manage', undefined)) throw new WorkcoreError('FORBIDDEN', 'Schedule management denied', 403);
    const item = body as Record<string, unknown>;
    const operation = String(item.operation ?? '');
    const def = operationAt(registration.definition, 'task', operation);
    if (!def || def.api !== true) throw new WorkcoreError('OPERATION_NOT_FOUND', 'Task is not externally exposed', 404);
    const validated = await validate(def.input, item.input ?? {});
    await authoriseOperation(registration, def, actor, scope, validated, options);
    const kind = item.kind === 'recurring' ? 'recurring' : 'once';
    const timezone = String(item.timezone ?? 'UTC');
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new WorkcoreError('INVALID_TIMEZONE', 'Unknown timezone', 400); }
    const runAt = kind === 'once' ? String(item.runAt ?? '') : undefined;
    if (kind === 'once' && (!Number.isFinite(Date.parse(runAt ?? '')) || Date.parse(runAt ?? '') <= Date.now())) throw new WorkcoreError('INVALID_SCHEDULE', 'One-off runAt must be a future date', 400);
    if (kind === 'recurring' && !isSupportedCron(String(item.cron ?? ''))) throw new WorkcoreError('INVALID_SCHEDULE', 'Recurring schedules require a supported five-field cron expression', 400);
    const schedule: ScheduleEntry = { id: randomId(), scope, operation, operationVersion: def.version ?? 1, input: encodeWithCodec(codec, validated), codecId: codec.id, actorId: actor.id, timezone, kind, enabled: true, createdAt: new Date().toISOString(), ...(runAt ? { runAt, nextRunAt: runAt } : { cron: String(item.cron), nextRunAt: nextScheduleOccurrence(String(item.cron), new Date(), timezone).toISOString() }) };
    await options.services.schedules.create(schedule);
    return json({ schedule: { ...schedule, input: validated } }, 201, {}, codec);
  }
  if (path.startsWith('schedules/') && request.method === 'DELETE') {
    if (!await canCapability(registration, options, actor, scope, 'workcore.schedules.manage', undefined)) throw new WorkcoreError('FORBIDDEN', 'Schedule management denied', 403);
    const id = decodeURIComponent(path.slice('schedules/'.length));
    const schedule = await options.services.schedules.get(id);
    if (!schedule || !sameScope(schedule.scope, scope)) throw new WorkcoreError('NOT_FOUND', 'Schedule not found', 404);
    await options.services.schedules.remove(id);
    return json({ ok: true }, 200, {}, codec);
  }
  if (path.startsWith('schedules/') && request.method === 'PATCH') {
    if (!await canCapability(registration, options, actor, scope, 'workcore.schedules.manage', undefined)) throw new WorkcoreError('FORBIDDEN', 'Schedule management denied', 403);
    const id = decodeURIComponent(path.slice('schedules/'.length));
    let schedule = await options.services.schedules.get(id);
    if (!schedule || !sameScope(schedule.scope, scope)) throw new WorkcoreError('NOT_FOUND', 'Schedule not found', 404);
    const patch = body as Record<string, unknown>;
    applySchedulePatch(schedule, patch);
    if (!await options.services.schedules.update(schedule)) {
      // A worker may reserve/update the schedule between GET and PATCH. Reapply
      // this narrow patch once to the latest revision rather than failing a
      // user action that is still valid against the current schedule.
      const latest = await options.services.schedules.get(id);
      if (!latest || !sameScope(latest.scope, scope)) throw new WorkcoreError('NOT_FOUND', 'Schedule not found', 404);
      schedule = latest;
      applySchedulePatch(schedule, patch);
      if (!await options.services.schedules.update(schedule)) throw new WorkcoreError('SCHEDULE_CONFLICT', 'Schedule changed concurrently; reload and retry', 409);
    }
    return json({ schedule: publicSchedule(await options.services.schedules.get(id) ?? schedule, options) }, 200, {}, codec);
  }
  if (path === 'query' || path === 'mutate' || path === 'enqueue') {
    if (request.method !== 'POST') throw new WorkcoreError('METHOD_NOT_ALLOWED', 'POST required', 405);
    const kind = path === 'query' ? 'query' : path === 'mutate' ? 'mutation' : 'task';
    const operationName = String((body as Record<string, unknown>).operation ?? '');
    const def = operationAt(registration.definition, kind, operationName);
    if (!def || def.api !== true) throw new WorkcoreError('OPERATION_NOT_FOUND', 'Operation is not externally exposed', 404);
    const validatedInput = await validate(def.input, input);
     await authoriseOperation(registration, def, actor, scope, validatedInput, options);
    if (kind === 'task') {
      const runId = randomId();
      const correlationId = request.headers.get('x-correlation-id') ?? randomId();
      await options.services.tasks.enqueue({ id: runId, applicationId, workspaceId, operation: operationName, operationVersion: def.version ?? 1, input: encodeWithCodec(codec, validatedInput), codecId: codec.id, actorId: actor.id, correlationId, createdAt: new Date().toISOString() });
      return json({ runId }, 202, {}, codec);
    }
    const executionId = randomId();
    const correlationId = request.headers.get('x-correlation-id') ?? randomId();
    const startedAt = Date.now();
    const entry: HistoryEntry = { id: executionId, scope, actorId: actor.id, kind, operation: operationName, status: 'running', startedAt: new Date(startedAt).toISOString() };
    let context: unknown;
    try {
      context = await registration.createAppContext({ scope, actor });
      const requestContext = createRequestContext(request);
      const result = await executeWithDeadline(request.signal, options.interactiveTimeoutMs ?? options.operationTimeoutMs ?? 30_000, (signal) => def.handler({
        ctx: createExecutionContext(scope, actor, correlationId, context, options.services, signal, undefined, requestContext),
        input: validatedInput,
        operations: createCaller(registration, actor, scope, correlationId, options, apps, signal, codec, undefined, 0, undefined, requestContext),
      }));
      const validatedResult = await validateOutput(def.output, result);
      const encodedResult = encodeWithCodec(codec, validatedResult);
      if (new TextEncoder().encode(JSON.stringify(encodedResult)).byteLength > (options.maxResultBytes ?? 2_097_152)) throw new WorkcoreError('RESULT_TOO_LARGE', 'Operation result exceeds configured limit', 413);
      const deliveryWarnings: string[] = [];
      if (kind === 'mutation') {
        const event: WorkcoreEvent = { id: randomId(), type: 'mutation.succeeded', applicationId, workspaceId, operation: operationName, executionId, actorId: actor.id, correlationId, createdAt: new Date().toISOString() };
        let published = false;
        try { await options.services.events.publish(event); published = true; } catch (error) {
          deliveryWarnings.push('EVENT_DELIVERY_FAILED');
          options.services.logger?.error('Mutation committed but success event publication failed', { executionId, detail: error instanceof Error ? error.message : String(error) });
        }
        try { if (published) await enqueueTriggeredTasks(registration, actor, scope, correlationId, event, options, codec); }
        catch (error) {
          deliveryWarnings.push('TRIGGER_DELIVERY_FAILED');
          options.services.logger?.error('Mutation committed but triggered task enqueue failed', { executionId, detail: safeMessage(error) });
        }
      }
      entry.status = deliveryWarnings.length ? 'delivery_failed' : 'succeeded';
      entry.finishedAt = new Date().toISOString();
      entry.durationMs = Date.now() - startedAt;
      if (!await safeHistory(options, entry)) deliveryWarnings.push('HISTORY_PERSISTENCE_FAILED');
      return json({ result: validatedResult, executionId, correlationId, ...(deliveryWarnings.length ? { deliveryWarning: deliveryWarnings[0], deliveryWarnings } : {}) }, 200, {}, codec);
    } catch (error) {
      entry.status = 'failed';
      entry.finishedAt = new Date().toISOString();
      entry.durationMs = Date.now() - startedAt;
      entry.error = { code: error instanceof WorkcoreError ? error.code : 'EXECUTION_FAILED', message: safeMessage(error) };
      await safeHistory(options, entry);
      if (error instanceof WorkcoreError) throw error;
      throw new WorkcoreError('EXECUTION_FAILED', safeMessage(error), 422);
    } finally {
      await cleanupContext(context, options.services.logger);
    }
  }
  throw new WorkcoreError('NOT_FOUND', 'Endpoint not found', 404);
}

async function authoriseOperation(registration: ApplicationRegistration, def: RuntimeOperation, actor: Actor, scope: Scope, input: unknown, options: PlatformOptions) {
  const policy = def.permission;
  if (policy === undefined) throw new WorkcoreError('FORBIDDEN', 'Operation has no permission policy', 403);
  if (typeof policy === 'function') {
    const allowed = await policy({ actor, scope, input, access: { has: (capability) => canCapability(registration, options, actor, scope, capability, input) } });
    if (!allowed) throw new WorkcoreError('FORBIDDEN', 'Operation permission denied', 403);
    return;
  }
  // An empty list explicitly requires no capability; workspace membership is still checked at the request boundary.
  const permissions = typeof policy === 'string' ? [policy] : policy;
  for (const permission of permissions) {
    if (!await canCapability(registration, options, actor, scope, permission, input)) throw new WorkcoreError('FORBIDDEN', 'Operation permission denied', 403);
  }
}

async function authoriseAgent(registration: ApplicationRegistration, def: RuntimeAgent, actor: Actor, scope: Scope, input: unknown, options: PlatformOptions) {
  return authoriseOperation(registration, { kind: 'task', input: def.input, output: def.input, ...(def.permission ? { permission: def.permission as Permission<unknown, unknown> } : {}), handler: async () => undefined }, actor, scope, input, options);
}

async function workspacePermissionAllowed(registration: ApplicationRegistration, actor: Actor, scope: Scope, permission: string, input: unknown): Promise<boolean | undefined> {
  const authorization = registration.definition.authorization;
  if (!authorization) return undefined;
  if (!registration.resolveAuthorization) return false;
  const auth = await validate(authorization.context, await registration.resolveAuthorization({ actor, scope }));
  return authorization.check({ auth, actor, scope, permission, input });
}

async function canCapability(registration: ApplicationRegistration, options: PlatformOptions, actor: Actor, scope: Scope, permission: string, input: unknown) {
  let hasAuthorizer = false;
  if (options.authorise) {
    hasAuthorizer = true;
    if (!await options.authorise({ actor, scope, permission, input })) return false;
  }
  const workspaceAllowed = await workspacePermissionAllowed(registration, actor, scope, permission, input);
  if (workspaceAllowed !== undefined) {
    hasAuthorizer = true;
    if (!workspaceAllowed) return false;
  }
  return hasAuthorizer;
}

async function validate(schema: AnySchema, value: unknown): Promise<unknown> {
  const result = await schema['~standard'].validate(value) as { value?: unknown; issues?: readonly { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] }[] };
  if (result.issues) {
    const issues: ValidationIssue[] = result.issues.map((issue) => ({ message: issue.message, ...(issue.path ? { path: issue.path.map((part) => typeof part === 'object' ? part.key : part).map((key) => typeof key === 'symbol' ? String(key) : key) } : {}) }));
    throw new WorkcoreError('VALIDATION_FAILED', issues.map((issue) => issue.message).join('; '), 400, issues);
  }
  return result.value;
}

async function validateOutput(schema: AnySchema, value: unknown): Promise<unknown> {
  try { return await validate(schema, value); }
  catch (error) {
    if (error instanceof WorkcoreError && error.code === 'VALIDATION_FAILED') {
      throw new WorkcoreError('OUTPUT_VALIDATION_FAILED', 'Handler completed but returned a value that failed output validation; side effects may already have occurred', 500);
    }
    throw error;
  }
}

async function executeWithDeadline<T>(parent: AbortSignal, timeoutMs: number, execute: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('operationTimeoutMs must be a positive finite number');
  if (parent.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Operation was aborted; side effects may have occurred', 499);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abortFromParent, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutError = new WorkcoreError('OPERATION_TIMEOUT', 'Operation exceeded its configured time limit; side effects may have occurred', 504);
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const rejectOnAbort = () => rejectAbort(timedOut ? timeoutError : new WorkcoreError('EXECUTION_ABORTED', 'Operation was aborted; side effects may have occurred', 499));
  controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Operation deadline exceeded'));
      reject(timeoutError);
    }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => execute(controller.signal)), timeout, aborted]); }
  finally {
    if (timer) clearTimeout(timer);
    controller.signal.removeEventListener('abort', rejectOnAbort);
    parent.removeEventListener('abort', abortFromParent);
  }
}

function createRequestContext(request?: Request): RequestContext | undefined {
  return request ? { url: request.url, method: request.method, headers: new Headers(request.headers) } : undefined;
}

function createExecutionContext(scope: Scope, actor: Actor, correlationId: string, app: unknown, services: PlatformServices, signal: AbortSignal, runId?: string, request?: RequestContext): ExecutionContext<unknown> {
  return {
    scope, actor, correlationId, signal, app,
    ...(request ? { request: { ...request, headers: new Headers(request.headers) } } : {}),
    services: {
      kv: {
        get: async (key) => services.kv.get(scope, key) as Promise<never>,
        set: (key, value) => services.kv.set(scope, key, value),
        delete: (key) => services.kv.delete(scope, key),
      },
      logger: services.logger ?? consoleLogger,
      tasks: { reportProgress: (percent) => runId ? services.tasks.progress(runId, percent) : Promise.resolve() },
    },
  };
}

function createCaller(registration: ApplicationRegistration, actor: Actor, scope: Scope, correlationId: string, options: PlatformOptions, apps: Map<string, ApplicationRegistration>, signal: AbortSignal, codec: WireCodec = jsonWireCodec, causationId?: string, triggerDepth = 0, currentExecutionId?: string, request?: RequestContext): OperationCaller {
  const invoke = async (kind: 'query' | 'mutation' | 'task', name: string, input: unknown) => {
    if (signal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Operation call was aborted', 499);
    if (!await options.services.workspaces.canAccess(actor, scope)) throw new WorkcoreError('FORBIDDEN', 'Workspace access denied', 403);
    const def = operationAt(registration.definition, kind, name);
    if (!def) throw new WorkcoreError('OPERATION_NOT_FOUND', `Unknown ${kind}: ${name}`, 404);
    const validInput = await validate(def.input, input);
    await authoriseOperation(registration, def, actor, scope, validInput, options);
    if (kind === 'task') {
      if (triggerDepth >= 8) throw new WorkcoreError('TRIGGER_DEPTH_EXCEEDED', 'Background operation trigger depth limit exceeded', 409);
      if (signal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Task enqueue was aborted', 499);
      const id = randomId();
      await options.services.tasks.enqueue({ id, applicationId: scope.applicationId, workspaceId: scope.workspaceId, operation: name, operationVersion: def.version ?? 1, input: encodeWithCodec(codec, validInput), codecId: codec.id, actorId: actor.id, correlationId, ...(currentExecutionId ? { causationId: currentExecutionId } : causationId ? { causationId } : {}), triggerDepth: triggerDepth + 1, createdAt: new Date().toISOString() });
      return { runId: id };
    }
    const executionId = randomId();
    const startedAt = Date.now();
    const entry: HistoryEntry = { id: executionId, scope, actorId: actor.id, kind, operation: name, status: 'running', startedAt: new Date(startedAt).toISOString() };
    const context = await registration.createAppContext({ scope, actor });
    try {
      const result = await executeWithDeadline(signal, options.interactiveTimeoutMs ?? options.operationTimeoutMs ?? 30_000, (executionSignal) => def.handler({ ctx: createExecutionContext(scope, actor, correlationId, context, options.services, executionSignal, undefined, request), input: validInput, operations: createCaller(registration, actor, scope, correlationId, options, apps, executionSignal, codec, causationId, triggerDepth, currentExecutionId, request) }));
      const validOutput = await validateOutput(def.output, result);
      let deliveryFailed = false;
      if (kind === 'mutation') {
        const event: WorkcoreEvent = { id: randomId(), type: 'mutation.succeeded', applicationId: scope.applicationId, workspaceId: scope.workspaceId, operation: name, executionId, actorId: actor.id, correlationId, ...(currentExecutionId ? { causationId: currentExecutionId } : causationId ? { causationId } : {}), triggerDepth: triggerDepth + 1, createdAt: new Date().toISOString() };
        let published = false;
        try { await options.services.events.publish(event); published = true; }
        catch (error) { deliveryFailed = true; options.services.logger?.error('Internal mutation committed but event publication failed', { executionId, detail: error instanceof Error ? error.message : String(error) }); }
        if (published) {
          try { await enqueueTriggeredTasks(registration, actor, scope, correlationId, event, options, codec); }
          catch (error) { deliveryFailed = true; options.services.logger?.error('Internal mutation committed but trigger enqueue failed', { executionId, detail: safeMessage(error) }); }
        }
      }
      entry.status = deliveryFailed ? 'delivery_failed' : 'succeeded';
      entry.finishedAt = new Date().toISOString();
      entry.durationMs = Date.now() - startedAt;
      await safeHistory(options, entry);
      return validOutput;
    } catch (error) {
      entry.status = 'failed';
      entry.finishedAt = new Date().toISOString();
      entry.durationMs = Date.now() - startedAt;
      entry.error = { code: error instanceof WorkcoreError ? error.code : 'EXECUTION_FAILED', message: safeMessage(error) };
      await safeHistory(options, entry);
      throw error;
    } finally { await cleanupContext(context, options.services.logger); }
  };
  return {
    query: (name, input) => invoke('query', name, input),
    mutate: (name, input) => invoke('mutation', name, input),
    enqueue: (name, input) => invoke('task', name, input) as Promise<{ runId: string }>,
    enqueueAgent: (name, input, agentOptions) => {
      if (signal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Agent enqueue was aborted', 499);
      return enqueueAgentRun(registration, actor, scope, correlationId, options, codec, name, input, agentOptions?.conversationId, currentExecutionId, triggerDepth, signal);
    },
  };
}

async function enqueueAgentRun(registration: ApplicationRegistration, actor: Actor, scope: Scope, correlationId: string, options: PlatformOptions, codec: WireCodec, name: string, rawInput: unknown, conversationId?: string, causationId?: string, triggerDepth = 0, signal?: AbortSignal) {
  if (triggerDepth >= 8) throw new WorkcoreError('TRIGGER_DEPTH_EXCEEDED', 'Background operation trigger depth limit exceeded', 409);
  const definition = registration.definition.agents?.[name];
  if (!definition) throw new WorkcoreError('OPERATION_NOT_FOUND', `Unknown agent: ${name}`, 404);
  if (!options.services.agentRuns) throw new WorkcoreError('AGENT_STORAGE_UNAVAILABLE', 'Agent run storage is not configured', 503);
  const input = await validate(definition.input, rawInput);
  await authoriseAgent(registration, definition, actor, scope, input, options);
  if (!await options.services.workspaces.canAccess(actor, scope)) throw new WorkcoreError('FORBIDDEN', 'Workspace access denied', 403);
  if (signal?.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Agent enqueue was aborted', 499);
  const id = randomId();
  const createdAt = new Date().toISOString();
  const run: AgentRun = { id, scope, actorId: actor.id, agent: name, status: 'queued', createdAt, correlationId, codecId: codec.id, ...(conversationId ? { conversationId } : {}) };
  await options.services.agentRuns.create(run);
  try {
    if (signal?.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Agent enqueue was aborted', 499);
    await options.services.tasks.enqueue({ id, applicationId: scope.applicationId, workspaceId: scope.workspaceId, operation: `@workcore/agent/${name}`, operationVersion: definition.version ?? 1, input: encodeWithCodec(codec, input), codecId: codec.id, actorId: actor.id, correlationId, ...(causationId ? { causationId } : {}), triggerDepth: triggerDepth + 1, createdAt });
  } catch (error) {
    run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = { code: 'AGENT_ENQUEUE_FAILED', message: safeMessage(error) };
    await options.services.agentRuns.update(run);
    throw error;
  }
  return { runId: id };
}

async function enqueueTriggeredTasks(registration: ApplicationRegistration, actor: Actor, scope: Scope, correlationId: string, event: WorkcoreEvent, options: PlatformOptions, codec: WireCodec) {
  if ((event.triggerDepth ?? 0) >= 8) throw new WorkcoreError('TRIGGER_DEPTH_EXCEEDED', 'Task trigger depth limit exceeded', 409);
  if (!await options.services.workspaces.canAccess(actor, scope)) throw new WorkcoreError('FORBIDDEN', 'Workspace access denied before triggered task enqueue', 403);
  const tasks = registration.definition.tasks ?? {};
  for (const [operation, definition] of Object.entries(tasks)) {
    if (!definition.triggers?.mutations?.includes(event.operation ?? '')) continue;
    const rawInput = definition.triggers.mapInput ? definition.triggers.mapInput(event) : {};
    const input = await validate(definition.input, rawInput);
    await authoriseOperation(registration, definition, actor, scope, input, options);
    const runId = randomId();
    await options.services.tasks.enqueue({
      id: runId, applicationId: scope.applicationId, workspaceId: scope.workspaceId,
      operation, operationVersion: definition.version ?? 1, input: encodeWithCodec(codec, input), codecId: codec.id, actorId: actor.id, correlationId, causationId: event.id, triggerDepth: (event.triggerDepth ?? 0) + 1, createdAt: new Date().toISOString(),
    });
  }
}

async function processClaimedTask(payload: TaskPayload, options: PlatformOptions, apps: Map<string, ApplicationRegistration>, signal: AbortSignal) {
  const registration = apps.get(payload.applicationId);
  if (!registration || !options.auth.resolveActor) {
    const error = { code: 'ACTOR_UNAVAILABLE', message: 'Task actor cannot be resolved by configured auth adapter' };
    await recordAgentPreflightFailure(payload, options, error);
    await recordTaskFailure(options, payload, error);
    return;
  }
  const actor = await options.auth.resolveActor(payload.actorId);
  const scope = { applicationId: payload.applicationId, workspaceId: payload.workspaceId };
  if (!actor || !await options.services.workspaces.canAccess(actor, scope)) {
    const error = { code: 'ACCESS_REVOKED', message: 'Task actor no longer has workspace access' };
    await recordAgentPreflightFailure(payload, options, error);
    await recordTaskFailure(options, payload, error);
    return;
  }
  const def = operationAt(registration.definition, 'task', payload.operation);
  const versionedDefinition = payload.operation.startsWith('@workcore/agent/') ? registration.definition.agents?.[payload.operation.slice('@workcore/agent/'.length)] : def;
  if (versionedDefinition && (payload.operationVersion ?? 1) !== (versionedDefinition.version ?? 1)) {
    const error = { code: 'OPERATION_VERSION_MISMATCH', message: 'Persisted input version does not match the registered operation; drain or migrate outstanding work before deployment' };
    await recordAgentPreflightFailure(payload, options, error);
    await recordTaskFailure(options, payload, error);
    return;
  }
  if (payload.operation.startsWith('@workcore/agent/')) {
    await processClaimedAgent(payload, registration, actor, scope, options, apps, signal);
    await publishAgentInvalidation(payload, scope, options);
    return;
  }
  if (!def) {
    await recordTaskFailure(options, payload, { code: 'OPERATION_NOT_FOUND', message: 'Registered task not found' });
    return;
  }
  let codec: WireCodec;
  let encodedResult: JsonValue;
  try {
    codec = resolveWireCodec(options, payload.codecId ?? 'json');
    const input = decodeStored(payload.input, payload.codecId, options);
    await authoriseOperation(registration, def, actor, scope, input, options);
    const context = await registration.createAppContext({ scope, actor });
    let result: unknown;
    try {
      result = await executeWithDeadline(signal, options.backgroundTimeoutMs ?? options.operationTimeoutMs ?? 5 * 60_000, (executionSignal) => def.handler({
        ctx: createExecutionContext(scope, actor, payload.correlationId, context, options.services, executionSignal, payload.id),
        input,
        operations: createCaller(registration, actor, scope, payload.correlationId, options, apps, executionSignal, codec, payload.causationId, payload.triggerDepth ?? 0, payload.id),
      }));
    } finally { await cleanupContext(context, options.services.logger); }
    const validatedResult = await validateOutput(def.output, result);
    encodedResult = encodeWithCodec(codec, validatedResult);
    if (new TextEncoder().encode(JSON.stringify(encodedResult)).byteLength > (options.maxResultBytes ?? 2_097_152)) throw new WorkcoreError('RESULT_TOO_LARGE', 'Task result exceeds configured limit', 413);
  } catch (error) {
    const taskError = { code: error instanceof WorkcoreError ? error.code : 'TASK_FAILED', message: safeMessage(error) };
    await recordTaskFailure(options, payload, taskError);
    return;
  }

  // Completion is the terminal execution transition. A queue-adapter failure is retried by
  // releasing the claim; schedule/event/history follow-up must never turn success into failure.
  await options.services.tasks.complete(payload.id, encodedResult);
  if (payload.scheduleId) {
    try {
      await options.services.schedules.clearActiveRun(payload.scheduleId, payload.id);
    } catch (error) { options.services.logger?.error('Task succeeded but schedule bookkeeping failed', { runId: payload.id, detail: safeMessage(error) }); }
  }
  const event: WorkcoreEvent = { id: randomId(), type: 'task.succeeded', applicationId: scope.applicationId, workspaceId: scope.workspaceId, operation: payload.operation, executionId: payload.id, actorId: actor.id, correlationId: payload.correlationId, createdAt: new Date().toISOString() };
  try { await options.services.events.publish(event); }
  catch (error) { options.services.logger?.error('Task completed but event publication failed', { runId: payload.id, detail: safeMessage(error) }); }
  await safeHistory(options, { id: payload.id, runId: payload.id, scope, actorId: actor.id, kind: 'task', operation: payload.operation, status: 'succeeded', startedAt: payload.createdAt, finishedAt: new Date().toISOString() });
}

async function publishAgentInvalidation(payload: TaskPayload, scope: Scope, options: PlatformOptions) {
  const run = await options.services.agentRuns?.get(scope, payload.id);
  if (!run || (run.status !== 'succeeded' && run.status !== 'failed' && run.status !== 'interrupted')) return;
  try {
    await options.services.events.publish({
      id: randomId(),
      type: 'workspace.invalidated',
      applicationId: scope.applicationId,
      workspaceId: scope.workspaceId,
      operation: payload.operation,
      executionId: payload.id,
      actorId: payload.actorId,
      correlationId: payload.correlationId,
      ...(payload.causationId ? { causationId: payload.causationId } : {}),
      triggerDepth: payload.triggerDepth ?? 0,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    options.services.logger?.error('Agent reached a terminal state but live invalidation could not be published', { runId: payload.id, detail: safeMessage(error) });
  }
}

async function recordAgentPreflightFailure(payload: TaskPayload, options: PlatformOptions, error: { code: string; message: string }) {
  if (!payload.operation.startsWith('@workcore/agent/')) return;
  const store = options.services.agentRuns;
  if (!store) return;
  const run = await store.get({ applicationId: payload.applicationId, workspaceId: payload.workspaceId }, payload.id);
  if (!run || run.status !== 'queued') return;
  run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = error; run.finishReason = error.code;
  await store.update(run);
}

async function processClaimedAgent(payload: TaskPayload, registration: ApplicationRegistration, actor: Actor, scope: Scope, options: PlatformOptions, apps: Map<string, ApplicationRegistration>, signal: AbortSignal) {
  const agentName = payload.operation.slice('@workcore/agent/'.length);
  const definition = registration.definition.agents?.[agentName];
  const store = options.services.agentRuns;
  if (!definition || !store) {
    if (store) {
      const missingRun = await store.get(scope, payload.id);
      if (missingRun) { missingRun.status = 'failed'; missingRun.finishedAt = new Date().toISOString(); missingRun.error = { code: 'AGENT_UNAVAILABLE', message: 'Agent definition is unavailable' }; await store.update(missingRun); }
    }
    await options.services.tasks.fail(payload.id, { code: 'AGENT_UNAVAILABLE', message: 'Agent definition or run storage is unavailable' });
    return;
  }
  const run = await store.get(scope, payload.id);
  if (!run) {
    await options.services.tasks.fail(payload.id, { code: 'AGENT_RUN_NOT_FOUND', message: 'Agent run metadata was not found' });
    return;
  }
  if (run.status === 'succeeded') {
    await options.services.tasks.complete(payload.id, run.result ?? null);
    return;
  }
  if (run.status === 'failed' || run.status === 'interrupted') {
    await options.services.tasks.fail(payload.id, run.error ?? { code: 'AGENT_INTERRUPTED', message: 'Agent run did not complete' });
    return;
  }
  if (run.status !== 'queued') {
    // A worker recovered an in-flight agent. Never replay model/tool effects automatically.
    if (run && run.status === 'running') {
      run.status = 'interrupted'; run.finishedAt = new Date().toISOString(); run.finishReason = 'worker_recovery';
      await store.update(run);
      await options.services.tasks.fail(payload.id, { code: 'AGENT_INTERRUPTED', message: 'Agent run was interrupted and was not automatically resumed' });
    }
    return;
  }
  if (!options.services.agentEngine) {
    run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = { code: 'AGENT_ENGINE_UNAVAILABLE', message: 'No agent engine is configured' };
    await store.update(run);
    await options.services.tasks.fail(payload.id, run.error);
    return;
  }
  const input = decodeStored(payload.input, payload.codecId, options);
  try {
    await authoriseAgent(registration, definition, actor, scope, input, options);
  } catch (error) {
    run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = { code: error instanceof WorkcoreError ? error.code : 'FORBIDDEN', message: safeMessage(error) };
    await store.update(run); await options.services.tasks.fail(payload.id, run.error); return;
  }
  run.status = 'running'; run.startedAt = new Date().toISOString();
  await store.update(run);
  let sequence = 0;
  const append = async (event: Omit<AgentTraceEvent, 'id' | 'runId' | 'sequence' | 'createdAt'>) => store.appendEvent({ ...event, id: randomId(), runId: run.id, sequence: ++sequence, createdAt: new Date().toISOString() });
  let context: unknown;
  let toolsEnabled = true;
  const agentAbortController = new AbortController();
  try {
    context = await registration.createAppContext({ scope, actor });
    await append({ type: 'run.started', data: { agent: agentName, model: definition.model } });
    const toolMap: Record<string, { description?: string; inputSchema: JsonSchema; execute: AgentToolExecutor }> = {};
    let toolExecutionQueue: Promise<void> = Promise.resolve();
    let finishToolSucceeded = false;
    let finishToolResult: unknown;
    let agentSignal = signal;
    for (const toolDefinition of definition.tools) {
      const toolName = `${toolDefinition.kind}.${toolDefinition.operation}`;
      if (toolMap[toolName]) throw new WorkcoreError('INVALID_AGENT', `Agent '${agentName}' declares duplicate tool '${toolName}'`, 500);
      const execute: AgentToolExecutor = (toolInput, toolSignal) => {
        const execution = toolExecutionQueue.then(async () => {
          if (!toolsEnabled || agentSignal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Agent run is no longer accepting tool calls', 499);
          if (finishToolSucceeded) throw new WorkcoreError('AGENT_ALREADY_FINISHED', 'The agent already called its terminating tool', 409);
          await append({ type: 'tool.started', data: { name: toolName, input: safeTraceValue(toolInput) } });
          try {
            if (!toolsEnabled || agentSignal.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Agent run is no longer accepting tool calls', 499);
            let result: unknown;
            const signals = [agentSignal, agentAbortController.signal, ...(toolSignal ? [toolSignal] : [])];
            const executionSignal = AbortSignal.any(signals);
            const toolCaller = createCaller(registration, actor, scope, payload.correlationId, options, apps, executionSignal, resolveWireCodec(options, payload.codecId ?? 'json'), payload.causationId, payload.triggerDepth ?? 0, payload.id);
            if (toolDefinition.kind === 'query') result = await toolCaller.query(toolDefinition.operation, toolInput);
            else if (toolDefinition.kind === 'mutation') result = await toolCaller.mutate(toolDefinition.operation, toolInput);
            else result = await toolCaller.enqueue(toolDefinition.operation, toolInput);
            if (toolName === definition.finishWhen.tool) { finishToolSucceeded = true; finishToolResult = result; }
            try { await append({ type: 'tool.completed', data: { name: toolName, result: safeTraceValue(result) } }); }
            catch (traceError) { options.services.logger?.error('Agent tool succeeded but its trace event could not be persisted', { runId: run.id, tool: toolName, detail: safeMessage(traceError) }); }
            return result;
          } catch (error) {
            try { await append({ type: 'tool.failed', data: { name: toolName, error: safeMessage(error) } }); }
            catch (traceError) { options.services.logger?.error('Agent tool failed and its trace event could not be persisted', { runId: run.id, tool: toolName, detail: safeMessage(traceError) }); }
            throw error;
          }
        });
        toolExecutionQueue = execution.then(() => undefined, () => undefined);
        return execution;
      };
      const toolOperation = operationAt(registration.definition, toolDefinition.kind, toolDefinition.operation)!;
      toolMap[toolName] = { ...(toolDefinition.description ? { description: toolDefinition.description } : {}), inputSchema: getJsonSchema(toolOperation.input, 'input'), execute };
    }
    if (!definition.tools.some((tool) => `${tool.kind}.${tool.operation}` === definition.finishWhen.tool)) throw new WorkcoreError('INVALID_AGENT', `Agent '${agentName}' finish tool '${definition.finishWhen.tool}' is not declared`, 500);
    let result: Awaited<ReturnType<AgentEngine['run']>>;
    try {
      result = await executeWithDeadline(signal, options.backgroundTimeoutMs ?? options.operationTimeoutMs ?? 5 * 60_000, async (deadlineSignal) => {
        agentSignal = AbortSignal.any([deadlineSignal, agentAbortController.signal]);
        const callContext = {
          ctx: createExecutionContext(scope, actor, payload.correlationId, context, options.services, agentSignal, payload.id),
          input,
          operations: createCaller(registration, actor, scope, payload.correlationId, options, apps, agentSignal, resolveWireCodec(options, payload.codecId ?? 'json'), payload.causationId, payload.triggerDepth ?? 0, payload.id),
        };
        const instructions = typeof definition.instructions === 'function' ? await definition.instructions(callContext) : definition.instructions;
        const prompt = await definition.prompt(callContext);
        return options.services.agentEngine!.run({
          model: definition.model, instructions, prompt, maxSteps: definition.maxSteps ?? 8, ...(definition.maxOutputTokens ? { maxOutputTokens: definition.maxOutputTokens } : {}), tools: toolMap, finishTool: definition.finishWhen.tool, signal: agentSignal,
          onEvent: append,
        });
      });
    } finally {
      toolsEnabled = false;
      if (!finishToolSucceeded && !agentAbortController.signal.aborted) agentAbortController.abort(new Error('Agent engine stopped before successful completion'));
    }
    if (!finishToolSucceeded || result.finishTool !== definition.finishWhen.tool) throw new WorkcoreError('AGENT_FINISH_CONDITION_NOT_MET', 'Agent stopped without successfully calling its configured finish tool', 422);
    const encoded = encodeWithCodec(resolveWireCodec(options, payload.codecId ?? 'json'), finishToolResult);
    if (new TextEncoder().encode(JSON.stringify(encoded)).byteLength > (options.maxResultBytes ?? 2_097_152)) throw new WorkcoreError('RESULT_TOO_LARGE', 'Agent result exceeds configured limit', 413);
    run.status = 'succeeded'; run.finishedAt = new Date().toISOString(); run.finishReason = `tool:${result.finishTool}`;
    run.result = encoded;
    try { await append({ type: 'run.completed', data: { finishReason: run.finishReason } }); }
    catch (traceError) { options.services.logger?.error('Agent succeeded but its completion trace could not be persisted', { runId: run.id, detail: safeMessage(traceError) }); }
    await store.update(run);
    try { await options.services.tasks.complete(payload.id, encoded); }
    catch (error) { options.services.logger?.error('Agent completed but task bookkeeping failed', { runId: payload.id, detail: safeMessage(error) }); }
  } catch (error) {
    toolsEnabled = false;
    if (!agentAbortController.signal.aborted) agentAbortController.abort(error);
    if (run.status === 'succeeded') {
      options.services.logger?.error('Agent reached its finish condition but terminal bookkeeping failed', { runId: run.id, detail: safeMessage(error) });
      try { await store.update(run); } catch (storeError) { options.services.logger?.error('Could not persist completed agent run', { runId: run.id, detail: safeMessage(storeError) }); }
      try { await options.services.tasks.complete(payload.id, run.result ?? null); } catch (taskError) { options.services.logger?.error('Could not mark completed agent queue item terminal', { runId: run.id, detail: safeMessage(taskError) }); }
      return;
    }
    run.status = signal.aborted ? 'interrupted' : 'failed'; run.finishedAt = new Date().toISOString();
    run.error = { code: error instanceof WorkcoreError ? error.code : 'AGENT_FAILED', message: safeMessage(error) };
    run.finishReason = signal.aborted ? 'cancelled' : 'error';
    try { await append({ type: 'run.failed', data: run.error as unknown as JsonValue }); } catch { /* trace delivery must not hide the original failure */ }
    await store.update(run);
    await options.services.tasks.fail(payload.id, run.error);
  } finally {
    if (context !== undefined) await cleanupContext(context, options.services.logger);
  }
}

function createWorker(options: PlatformOptions, apps: Map<string, ApplicationRegistration>) {
  let stopping = false;
  const controller = new AbortController();
  let workerPromise: Promise<void> | undefined;
  let scheduleTimer: ReturnType<typeof setInterval> | undefined;
  let schedulePromise: Promise<void> | undefined;
  let consecutiveErrors = 0;
  const run = async () => {
    while (!stopping) {
      let claimed: TaskPayload | undefined;
      try {
        claimed = await options.services.tasks.claim();
        if (!claimed) { await options.services.tasks.waitForWork(controller.signal); continue; }
        const activeRunId = claimed.id;
        const heartbeat = options.services.tasks.heartbeat ? setInterval(() => {
          void options.services.tasks.heartbeat!(activeRunId).catch((error) => options.services.logger?.warn('Task lease heartbeat failed', { runId: activeRunId, detail: safeMessage(error) }));
        }, 10_000) : undefined;
        try { await processClaimedTask(claimed, options, apps, controller.signal); }
        finally { if (heartbeat) clearInterval(heartbeat); }
        claimed = undefined;
        consecutiveErrors = 0;
      } catch (error) {
        if (stopping) break;
        consecutiveErrors++;
        options.services.logger?.error('Worker iteration failed; retrying', { detail: safeMessage(error) });
        if (claimed) {
          try { await options.services.tasks.release(claimed.id); }
          catch (releaseError) { options.services.logger?.error('Could not release claimed task after worker failure', { runId: claimed.id, detail: safeMessage(releaseError) }); }
        }
        const baseDelay = Math.max(1, options.workerRetryDelayMs ?? 1_000);
        const retryDelay = Math.min(baseDelay * 2 ** Math.min(consecutiveErrors - 1, 10), 30_000);
        await delayOrAbort(retryDelay, controller.signal);
      }
    }
  };
  return {
    start: () => {
      if (workerPromise) return;
      stopping = false;
      workerPromise = run();
      scheduleTimer = setInterval(() => {
        if (schedulePromise) return;
        schedulePromise = handleScheduleDue(options, apps)
          .catch((error) => options.services.logger?.error('Schedule polling failed', { detail: safeMessage(error) }))
          .finally(() => { schedulePromise = undefined; });
      }, 1_000);
      controller.signal.addEventListener('abort', () => { if (scheduleTimer) clearInterval(scheduleTimer); }, { once: true });
    },
    stop: async () => {
      stopping = true;
      controller.abort();
      if (scheduleTimer) clearInterval(scheduleTimer);
      const pending = Promise.all([workerPromise, schedulePromise]);
      const graceMs = options.shutdownTimeoutMs ?? 10_000;
      if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('shutdownTimeoutMs must be a non-negative finite number');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([pending, new Promise<void>((resolve) => { timer = setTimeout(resolve, graceMs); })]); }
      finally { if (timer) clearTimeout(timer); }
    },
    run,
  };
}

function delayOrAbort(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function recordTaskFailure(options: PlatformOptions, payload: TaskPayload, error: { code: string; message: string }) {
  await options.services.tasks.fail(payload.id, error);
  if (payload.scheduleId) {
    await options.services.schedules.clearActiveRun(payload.scheduleId, payload.id);
  }
  await safeHistory(options, {
    id: payload.id, runId: payload.id,
    scope: { applicationId: payload.applicationId, workspaceId: payload.workspaceId },
    actorId: payload.actorId, kind: 'task', operation: payload.operation, status: 'failed',
    startedAt: payload.createdAt, finishedAt: new Date().toISOString(), error,
  });
  await options.services.events.publish({
    id: randomId(), type: 'task.failed', applicationId: payload.applicationId, workspaceId: payload.workspaceId,
    operation: payload.operation, executionId: payload.id, actorId: payload.actorId, correlationId: payload.correlationId,
    ...(payload.causationId ? { causationId: payload.causationId } : {}), triggerDepth: payload.triggerDepth ?? 0, createdAt: new Date().toISOString(),
  }).catch((eventError) => options.services.logger?.error('Task failure was recorded but its event could not be published', { runId: payload.id, detail: safeMessage(eventError) }));
}

async function eventStream(request: Request, scope: Scope, actor: Actor, registration: ApplicationRegistration, options: PlatformOptions, apps: Map<string, ApplicationRegistration>, trustedOrigins: ReadonlySet<string>) {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const stream = new ReadableStream<Uint8Array>({
    start(controllerStream) {
      let closed = false;
      let unsubscribe = () => {};
      const heartbeat = setInterval(() => send({ type: 'heartbeat', at: Date.now() }), 20_000);
      const refresh = setInterval(() => {
        void (async () => {
          if (!await options.services.workspaces.canAccess(actor, scope)) { abort(); return; }
          send({ type: 'refresh' });
        })().catch((error) => {
          options.services.logger?.error('Live access refresh failed; closing event stream', { detail: safeMessage(error) });
          abort();
        });
      }, options.liveRefreshMs ?? 60_000);
      const close = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener('abort', abort);
        clearInterval(heartbeat);
        clearInterval(refresh);
        try { unsubscribe(); }
        catch (error) { options.services.logger?.error('Could not unsubscribe event stream', { detail: safeMessage(error) }); }
        try { controllerStream.close(); }
        catch (error) { options.services.logger?.debug('Event stream was already closed', { detail: safeMessage(error) }); }
      };
      const send = (payload: unknown) => {
        if (closed) return;
        try { controllerStream.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); }
        catch (error) {
          options.services.logger?.debug('Could not write to event stream', { detail: safeMessage(error) });
          abort();
        }
      };
      controller.signal.addEventListener('abort', close, { once: true });
      unsubscribe = options.services.events.subscribe(scope, (event) => {
        void (async () => {
          if (event.type !== 'mutation.succeeded' && event.type !== 'task.succeeded' && event.type !== 'task.failed' && event.type !== 'workspace.invalidated') return;
          if (!await options.services.workspaces.canAccess(actor, scope)) { abort(); return; }
          send({ type: 'invalidate', eventId: event.id });
        })().catch((error) => {
          options.services.logger?.error('Live event processing failed; closing event stream', { detail: safeMessage(error) });
          abort();
        });
      });
      if (controller.signal.aborted) close();
      else send({ type: 'ready' });
    },
    cancel() { abort(); },
  });
  // Keep references alive in the closure and make access revocation observable.
  void registration; void apps;
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', ...corsHeaders(request, trustedOrigins) } });
}

async function makeManifest(registration: ApplicationRegistration, actor: Actor, scope: Scope, options: PlatformOptions) {
  const definition = registration.definition;
  const operations: Array<Record<string, unknown>> = [];
  const operationViews: CompiledOperationPresentation[] = [];
  const visibleMutations = new Set<string>();
  const visibleQueries = new Set<string>();
  for (const [name, def] of Object.entries(definition.queries ?? {})) {
    if (def.api === true && await permissionVisible(registration, def, actor, scope, options)) visibleQueries.add(name);
  }
  for (const [name, def] of Object.entries(definition.mutations ?? {})) {
    if (def.api === true && await permissionVisible(registration, def, actor, scope, options)) visibleMutations.add(name);
  }
  for (const [kind, map] of [['query', definition.queries], ['mutation', definition.mutations], ['task', definition.tasks]] as const) {
    for (const [name, def] of Object.entries(map ?? {})) {
      if (def.api !== true || !await permissionVisible(registration, def, actor, scope, options)) continue;
      const inputSchema = getJsonSchema(def.input, 'input');
      const outputSchema = getJsonSchema(def.output, 'output');
       const views = def.views ? {
         ...def.views,
          variants: Object.fromEntries(Object.entries(def.views.variants).map(([variantName, variant]) => {
              const { chat, chatActions, chatList, ...safeVariant } = variant;
             const safeCollection = variant.collection ? (() => {
               const { editor, actions = [], ...collectionFields } = variant.collection;
               const visibleActions = actions.filter((action) => visibleMutations.has(action.mutation));
               return {
                 ...collectionFields,
                 ...(editor && visibleMutations.has(editor.mutation) ? { editor } : {}),
                 ...(visibleActions.length ? { actions: visibleActions } : {}),
               };
             })() : undefined;
             const safeChat = chat ? {
              ...chat,
              ...(chat.actions ? { actions: Object.fromEntries(Object.entries(chat.actions).filter(([, mapping]) => visibleMutations.has(mapping.mutation))) } : {}),
            } : undefined;
             const safeChatActions = chatActions ? Object.fromEntries(Object.entries(chatActions).filter(([, mapping]) => visibleMutations.has(mapping.mutation))) : undefined;
             const safeChatList = chatList ? (() => {
               const { threadQuery, ...listOptions } = chatList;
               return threadQuery && visibleQueries.has(threadQuery) ? chatList : listOptions;
             })() : undefined;
            return [variantName, {
              ...safeVariant,
              ...(variant.actions ? { actions: variant.actions.filter((action) => visibleMutations.has(action.mutation)) } : {}),
               ...(safeCollection ? { collection: safeCollection } : {}),
               ...(safeChatActions ? { chatActions: safeChatActions } : {}),
               ...(safeChatList ? { chatList: safeChatList } : {}),
               ...(safeChat && (!safeChat.sendMutation || visibleMutations.has(safeChat.sendMutation)) ? { chat: safeChat } : {}),
           }];
         })),
      } : undefined;
      operationViews.push(views && def.views
        ? { operation: name, kind, default: def.views.default, variants: views.variants }
        : { operation: name, kind, default: kind === 'query' ? 'json' : 'form', variants: { [kind === 'query' ? 'json' : 'form']: { title: name, renderer: kind === 'query' ? 'json' : 'form' } } });
      operations.push({ name, kind, input: inputSchema, output: outputSchema });
    }
  }
  const builtinEnabled = (id: 'operations' | 'tasks' | 'schedules' | 'history' | 'agents') => definition.admin?.builtins?.[id] !== false;
  const capabilities = {
    tasksRead: await canCapability(registration, options, actor, scope, 'workcore.tasks.read', undefined),
    schedulesRead: await canCapability(registration, options, actor, scope, 'workcore.schedules.read', undefined),
    schedulesManage: await canCapability(registration, options, actor, scope, 'workcore.schedules.manage', undefined),
    historyRead: await canCapability(registration, options, actor, scope, 'workcore.history.read', undefined),
    agentRunsRead: await canCapability(registration, options, actor, scope, 'workcore.agents.runs.read', undefined),
    agentRunsReadAll: await canCapability(registration, options, actor, scope, 'workcore.agents.runs.read.all', undefined),
    agentResultsRead: await canCapability(registration, options, actor, scope, 'workcore.agents.results.read', undefined),
    agentMessagesRead: await canCapability(registration, options, actor, scope, 'workcore.agents.messages.read', undefined),
    agentToolsRead: await canCapability(registration, options, actor, scope, 'workcore.agents.tools.read', undefined),
    agentToolPayloadsRead: await canCapability(registration, options, actor, scope, 'workcore.agents.toolPayloads.read', undefined),
  };
  const pages: AdminManifestPage[] = [];
  if (builtinEnabled('operations') && operations.length) pages.push({
    id: 'operations', title: 'Operations', description: 'Explore validated operations available in this workspace.', layout: 'two-column', builtin: true,
    blocks: [
      { id: 'operation-catalog', type: 'operation-catalog', selection: 'operation' },
      { id: 'operation-executor', type: 'operation-executor', selection: 'operation' },
    ],
  });
  if (builtinEnabled('tasks') && capabilities.tasksRead) pages.push({ id: 'tasks', title: 'Task runs', description: 'Inspect queued, running and completed tasks.', blocks: [{ id: 'task-runs', type: 'resource', resource: 'tasks', title: 'Task runs' }], builtin: true });
  if (builtinEnabled('schedules') && capabilities.schedulesRead) pages.push({ id: 'schedules', title: 'Schedules', description: 'Manage recurring and one-off task schedules.', blocks: [{ id: 'schedules', type: 'resource', resource: 'schedules', title: 'Schedules' }], builtin: true });
  if (builtinEnabled('history') && capabilities.historyRead) pages.push({ id: 'history', title: 'History', description: 'Recent execution outcomes for this workspace.', blocks: [{ id: 'history', type: 'resource', resource: 'history', title: 'History' }], builtin: true });
  if (builtinEnabled('agents') && options.services.agentRuns && capabilities.agentRunsRead) pages.push({ id: 'agents', title: 'Agent runs', description: 'Inspect agent execution status and authorized trace details.', blocks: [{ id: 'agent-runs', type: 'resource', resource: 'agents', title: 'Agent runs' }], builtin: true });
  for (const [id, page] of Object.entries(definition.admin?.pages ?? {})) {
    const blocks = page.blocks.filter((block) => block.type === 'custom' ? true : block.type === 'resource'
      ? (block.resource === 'tasks' ? capabilities.tasksRead : block.resource === 'schedules' ? capabilities.schedulesRead : block.resource === 'history' ? capabilities.historyRead : Boolean(options.services.agentRuns && capabilities.agentRunsRead))
      : block.type === 'operation-catalog' || block.type === 'operation-executor'
        ? operations.length > 0
      : operations.some((operation) => operation.name === block.operation && ((block.type === 'query' && operation.kind === 'query') || (block.type === 'mutation-form' && operation.kind === 'mutation') || (block.type === 'task-launcher' && operation.kind === 'task'))));
     if (blocks.length) pages.push({ id, ...page, blocks });
  }
  const semanticPages = pages.map((page) => ({ ...page, layout: normalizeSemanticLayout(page.layout) }));
  const semanticDefaultPage = semanticPages.some((page) => page.id === definition.admin?.defaultPage) ? definition.admin!.defaultPage : semanticPages[0]?.id;
  const hasOperationComposition = semanticPages.some((page) => page.blocks.some((block) => block.type === 'operation-catalog' || block.type === 'operation-executor'));
  const hasCollections = operationViews.some((view) => Object.values(view.variants).some((variant) => !!variant.collection));
  const hasCustomBlocks = semanticPages.some((page) => page.blocks.some((block) => block.type === 'custom'));
  return { protocolVersion: 2, schemaDialect: 'https://json-schema.org/draft/2020-12/schema', applicationId: definition.id, operations, interface: { version: 1, requiredFeatures: [...(operationViews.length ? ['operation-views-v1'] : []), ...(hasCollections ? ['collection-editor-v1'] : []), ...(hasOperationComposition ? ['operation-catalog-v1'] : []), ...(hasCustomBlocks ? ['custom-placeholder-v1'] : [])], pages: semanticPages, ...(semanticDefaultPage ? { defaultPage: semanticDefaultPage } : {}), operationViews }, capabilities };
}

function normalizeSemanticLayout(layout: AdminManifestPage['layout']): 'stack' | 'grid' | 'page' {
  return layout === 'two-column' || layout === 'overview' ? 'grid' : layout === 'stacked' ? 'stack' : 'page';
}

async function permissionVisible(registration: ApplicationRegistration, definition: RuntimeOperation, actor: Actor, scope: Scope, options: PlatformOptions) {
  if (definition.permission === undefined) return false;
  // Input-aware policies are decided at execution; an empty list explicitly requires no capability.
  if (typeof definition.permission === 'function' || (Array.isArray(definition.permission) && definition.permission.length === 0)) return true;
  const permissions = typeof definition.permission === 'string' ? [definition.permission] : definition.permission;
  for (const permission of permissions) if (!await canCapability(registration, options, actor, scope, permission, undefined)) return false;
  return true;
}

function isAgentRunStatus(value: string | undefined): value is AgentRunStatus {
  return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'interrupted';
}

async function projectAgentRun(run: AgentRun, registration: ApplicationRegistration, actor: Actor, scope: Scope, options: PlatformOptions) {
  const visible = await canCapability(registration, options, actor, scope, 'workcore.agents.results.read', undefined);
  const { result: _result, ...metadata } = run;
  return visible ? { ...metadata, ...(run.result === undefined ? {} : { result: decodeStored(run.result, run.codecId, options) }) } : metadata;
}

function projectAgentEvent(event: AgentTraceEvent, permissions: { canReadTools: boolean; canReadPayloads: boolean; canReadMessages: boolean }): AgentTraceEvent {
  if (event.type.startsWith('tool.') && !permissions.canReadTools) return { ...event, data: { redacted: true } };
  if (event.type.startsWith('tool.') && !permissions.canReadPayloads && event.data && typeof event.data === 'object' && !Array.isArray(event.data)) {
    const { input: _input, result: _result, preview: _preview, ...safe } = event.data;
    return { ...event, data: safe };
  }
  if ((event.type === 'step.completed' || event.type === 'step.started') && !permissions.canReadMessages) return { ...event, data: { redacted: true } };
  if (event.type.startsWith('step.') && event.data && typeof event.data === 'object' && !Array.isArray(event.data)) {
    const data = { ...event.data };
    if (!permissions.canReadTools) delete data.toolCalls;
    else if (!permissions.canReadPayloads) {
      if (Array.isArray(data.toolCalls)) {
        data.toolCalls = data.toolCalls.map((call) => call && typeof call === 'object' && !Array.isArray(call)
          ? (typeof call.toolName === 'string' ? { toolName: call.toolName } : {})
          : {});
      } else delete data.toolCalls;
    }
    if (!permissions.canReadPayloads) delete data.preview;
    return { ...event, data };
  }
  return event;
}

function getJsonSchema(schema: AnySchema, direction: 'input' | 'output'): JsonSchema {
  const provider = schema as unknown as JsonSchemaProvider;
  if (!provider['~standard'].jsonSchema) throw new WorkcoreError('SCHEMA_CONVERSION_MISSING', 'Operation schema must implement Standard JSON Schema to appear in the admin manifest', 500);
  const options = {
    target: 'draft-2020-12',
    ...(provider['~standard'].vendor === 'zod' ? { libraryOptions: { unrepresentable: 'any' } } : {}),
  };
  return provider['~standard'].jsonSchema[direction](options);
}

export function validateDefinition(definition: RuntimeDefinition) {
  for (const operation of [...Object.values(definition.queries ?? {}), ...Object.values(definition.mutations ?? {}), ...Object.values(definition.tasks ?? {}), ...Object.values(definition.agents ?? {})]) {
    if (operation.version !== undefined && (!Number.isSafeInteger(operation.version) || operation.version < 1)) throw new Error('Operation versions must be positive safe integers');
  }
  if (definition.authorization && (!definition.authorization.context?.['~standard']?.validate || typeof definition.authorization.check !== 'function')) throw new Error('Application authorization must provide a Standard Schema context and check function');
  const mutationNames = new Set(Object.keys(definition.mutations ?? {}));
  for (const [name, configured] of Object.entries(definition.agents ?? {})) {
    const agentDefinition = configured as RuntimeAgent;
    if (!agentDefinition.input?.['~standard']?.validate) throw new Error(`Agent '${name}' must provide a Standard Schema input`);
    if (typeof agentDefinition.model !== 'string' || !agentDefinition.model.trim()) throw new Error(`Agent '${name}' requires a model`);
    if (typeof agentDefinition.prompt !== 'function' || !(typeof agentDefinition.instructions === 'string' || typeof agentDefinition.instructions === 'function')) throw new Error(`Agent '${name}' requires instructions and a prompt`);
    if (!Array.isArray(agentDefinition.tools) || !agentDefinition.tools.length) throw new Error(`Agent '${name}' must declare at least one tool`);
    if (!Number.isInteger(agentDefinition.maxSteps ?? 8) || (agentDefinition.maxSteps ?? 8) < 1 || (agentDefinition.maxSteps ?? 8) > 100) throw new Error(`Agent '${name}' maxSteps must be between 1 and 100`);
    if (agentDefinition.maxOutputTokens !== undefined && (!Number.isInteger(agentDefinition.maxOutputTokens) || agentDefinition.maxOutputTokens < 1)) throw new Error(`Agent '${name}' maxOutputTokens must be a positive integer`);
    const toolNames = new Set<string>();
    for (const tool of agentDefinition.tools) {
      const toolName = `${tool.kind}.${tool.operation}`;
      if (toolNames.has(toolName)) throw new Error(`Agent '${name}' declares duplicate tool '${toolName}'`);
      toolNames.add(toolName);
      if (!operationAt(definition, tool.kind, tool.operation)) throw new Error(`Agent '${name}' references unknown ${tool.kind} '${tool.operation}'`);
      getJsonSchema(operationAt(definition, tool.kind, tool.operation)!.input, 'input');
    }
    if (!agentDefinition.finishWhen?.tool || !toolNames.has(agentDefinition.finishWhen.tool)) throw new Error(`Agent '${name}' finishWhen.tool must reference one of its declared tools`);
  }
  const pageNames = new Set<string>();
  for (const [pageId, page] of Object.entries(definition.admin?.pages ?? {})) {
    if (['operations', 'tasks', 'schedules', 'history', 'agents'].includes(pageId)) throw new Error(`Admin page '${pageId}' uses a reserved built-in page id`);
    if (pageNames.has(pageId)) throw new Error(`Duplicate admin page '${pageId}'`);
    pageNames.add(pageId);
    if (!page.title || !Array.isArray(page.blocks)) throw new Error(`Admin page '${pageId}' requires a title and blocks`);
    if (page.layout && !['stacked', 'two-column', 'overview'].includes(page.layout)) throw new Error(`Admin page '${pageId}' has an unsupported layout '${page.layout}'`);
    for (const [stateName, state] of Object.entries(page.state ?? {})) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(stateName) || !state.label || typeof state.default !== 'string') throw new Error(`Admin page '${pageId}' has an invalid state declaration '${stateName}'`);
      if (state.type === 'text') continue;
      if (state.type !== 'select' || !Array.isArray(state.options) || !state.options.length) throw new Error(`Admin page '${pageId}' state '${stateName}' must be text or a select with options`);
      const optionValues = new Set<string>();
      for (const option of state.options) {
        if (!option || typeof option.value !== 'string' || typeof option.label !== 'string' || optionValues.has(option.value)) throw new Error(`Admin page '${pageId}' state '${stateName}' has invalid or duplicate select options`);
        optionValues.add(option.value);
      }
      if (!optionValues.has(state.default)) throw new Error(`Admin page '${pageId}' state '${stateName}' default must match one of its select options`);
    }
    const blockIds = new Set<string>();
    const catalogSelections = new Set<string>();
    const executorSelections = new Set<string>();
    for (const block of page.blocks) {
      if (!block.id || blockIds.has(block.id)) throw new Error(`Admin page '${pageId}' has a missing or duplicate block id '${block.id}'`);
      blockIds.add(block.id);
      if (block.type === 'operation-catalog' || block.type === 'operation-executor') {
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(block.selection)) throw new Error(`Admin page '${pageId}' block '${block.id}' has an invalid operation selection key`);
        const selections = block.type === 'operation-catalog' ? catalogSelections : executorSelections;
        if (selections.has(block.selection)) throw new Error(`Admin page '${pageId}' has duplicate ${block.type} selection '${block.selection}'`);
        selections.add(block.selection);
        continue;
      }
      if (block.type === 'resource') continue;
      if (block.type === 'custom') {
        if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\/[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(block.component) || !Number.isSafeInteger(block.version) || block.version < 1) throw new Error(`Admin page '${pageId}' block '${block.id}' has an invalid custom component reference`);
        if (block.props !== undefined) assertSemanticJson(block.props, `admin page '${pageId}' block '${block.id}' custom props`);
        continue;
      }
      const expected = block.type === 'query' ? definition.queries?.[block.operation] : block.type === 'mutation-form' ? definition.mutations?.[block.operation] : definition.tasks?.[block.operation];
      if (!expected) throw new Error(`Admin page '${pageId}' block '${block.id}' references an unknown ${block.type} operation '${block.operation}'`);
      if (expected.api !== true) throw new Error(`Admin page '${pageId}' block '${block.id}' references '${block.operation}', which is not exposed to the admin API`);
       const hasOperationView = Boolean(block.variant && expected.views && Object.hasOwn(expected.views.variants, block.variant));
       if (block.variant && !hasOperationView) throw new Error(`Admin page '${pageId}' block '${block.id}' references unknown variant '${block.variant}'`);
      if (block.type === 'query' && block.inputBindings) {
        const inputSchema = getJsonSchema(expected.input, 'input');
        const inputProperties = inputSchema.properties && typeof inputSchema.properties === 'object' ? inputSchema.properties as Record<string, { type?: unknown }> : {};
        for (const [target, binding] of Object.entries(block.inputBindings)) {
          if (!binding || typeof binding !== 'object' || !('state' in binding) || typeof binding.state !== 'string') throw new Error(`Admin page '${pageId}' block '${block.id}' has an invalid binding for query input '${target}'`);
          if (!inputProperties[target]) throw new Error(`Admin page '${pageId}' block '${block.id}' binds unknown query input '${target}'`);
           if (inputProperties[target]?.type !== 'string') throw new Error(`Admin page '${pageId}' block '${block.id}' text state binding requires string query input '${target}'`);
           if (Object.hasOwn(block.input ?? {}, target)) throw new Error(`Admin page '${pageId}' block '${block.id}' query input '${target}' cannot be both literal and state-bound`);
           if (!Object.hasOwn(page.state ?? {}, binding.state)) throw new Error(`Admin page '${pageId}' block '${block.id}' references unknown page state '${binding.state}'`);
           const state = page.state?.[binding.state];
           const targetSchema = inputProperties[target] as { enum?: unknown };
           if (state?.type === 'select') {
             const allowedValues = new Set(Array.isArray(targetSchema.enum) ? targetSchema.enum.filter((entry): entry is string => typeof entry === 'string') : []);
             const required = ((inputSchema.required as string[] | undefined) ?? []).includes(target);
             if (!Array.isArray(targetSchema.enum) || state.options.some((option) => option.value !== '' && !allowedValues.has(option.value))) throw new Error(`Admin page '${pageId}' block '${block.id}' select state '${binding.state}' options must match query enum input '${target}'`);
             if (state.options.some((option) => option.value === '') && required) throw new Error(`Admin page '${pageId}' block '${block.id}' select state '${binding.state}' cannot clear required query input '${target}'`);
           }
        }
      }
    }
    for (const selection of new Set([...catalogSelections, ...executorSelections])) {
      if (!catalogSelections.has(selection) || !executorSelections.has(selection)) throw new Error(`Admin page '${pageId}' operation selection '${selection}' requires one catalog and one executor`);
    }
  }
  const builtInPages = ['operations', 'tasks', 'schedules', 'history', 'agents'] as const;
  if (definition.admin?.defaultPage && !definition.admin.pages?.[definition.admin.defaultPage] && !builtInPages.includes(definition.admin.defaultPage as typeof builtInPages[number])) throw new Error(`Unknown default admin page '${definition.admin.defaultPage}'`);
  if (definition.admin?.defaultPage && builtInPages.includes(definition.admin.defaultPage as typeof builtInPages[number]) && definition.admin.builtins?.[definition.admin.defaultPage as typeof builtInPages[number]] === false) throw new Error(`Default admin page '${definition.admin.defaultPage}' is disabled`);
  for (const [kind, operations] of [['query', definition.queries], ['mutation', definition.mutations], ['task', definition.tasks]] as const) {
    for (const [name, operation] of Object.entries(operations ?? {})) {
      if (!operation.input?.['~standard']?.validate || !operation.output?.['~standard']?.validate) throw new Error(`${kind} '${name}' must provide Standard Schema input and output`);
      if (operation.api === true) {
        getJsonSchema(operation.input, 'input');
        getJsonSchema(operation.output, 'output');
      }
      if (operation.views) {
        if (!operation.views.variants[operation.views.default]) throw new Error(`${kind} '${name}' default view '${operation.views.default}' does not exist`);
        for (const [variantName, variant] of Object.entries(operation.views.variants)) {
          if (kind === 'query' && variant.renderer === 'form') throw new Error(`Query '${name}' cannot use form renderer '${variantName}'`);
          if (kind === 'query' && variant.chat?.sendMutation) {
            if (!variant.chat.messageInput) throw new Error(`Chat query '${name}' renderer '${variantName}' must declare chat.messageInput with chat.sendMutation`);
            const chatMutation = definition.mutations?.[variant.chat.sendMutation];
            if (!chatMutation) throw new Error(`Chat query '${name}' references unknown send mutation '${variant.chat.sendMutation}'`);
            const inputProperties = getJsonSchema(chatMutation.input, 'input').properties as Record<string, unknown> | undefined;
            if (!inputProperties?.[variant.chat.messageInput]) throw new Error(`Chat query '${name}' references unknown message input '${variant.chat.messageInput}' on '${variant.chat.sendMutation}'`);
            if (variant.chat.conversationIdInput && !inputProperties[variant.chat.conversationIdInput]) throw new Error(`Chat query '${name}' references unknown conversation input '${variant.chat.conversationIdInput}' on '${variant.chat.sendMutation}'`);
            if (variant.chat.conversationQueryInput) {
              const queryProperties = getJsonSchema(operation.input, 'input').properties as Record<string, unknown> | undefined;
              if (!queryProperties?.[variant.chat.conversationQueryInput]) throw new Error(`Chat query '${name}' references unknown query input '${variant.chat.conversationQueryInput}'`);
            }
            for (const inputName of Object.keys(variant.chat.inputBindings ?? {})) {
              if (!inputProperties?.[inputName]) throw new Error(`Chat query '${name}' binds unknown send input '${inputName}' on '${variant.chat.sendMutation}'`);
            }
            const requiredSendFields = (getJsonSchema(chatMutation.input, 'input').required as string[] | undefined) ?? [];
            const supportedSendFields = new Set([variant.chat.messageInput, ...(variant.chat.conversationIdInput ? [variant.chat.conversationIdInput] : []), ...Object.keys(variant.chat.inputBindings ?? {})]);
            const unsupportedRequiredField = requiredSendFields.find((field) => !supportedSendFields.has(field));
            if (unsupportedRequiredField) throw new Error(`Chat query '${name}' send mutation '${variant.chat.sendMutation}' has unsupported required input '${unsupportedRequiredField}'`);
          }
          if (kind === 'query' && variant.chatList) {
            const listInputProperties = getJsonSchema(operation.input, 'input').properties as Record<string, unknown> | undefined;
            if (variant.chatList.searchInput && !listInputProperties?.[variant.chatList.searchInput]) throw new Error(`Chat list '${name}.${variantName}' references unknown search input '${variant.chatList.searchInput}'`);
            if (variant.chatList.threadQuery) {
              const detail = definition.queries?.[variant.chatList.threadQuery];
              if (!detail || detail.api !== true) throw new Error(`Chat list '${name}.${variantName}' references unknown or unexposed thread query '${variant.chatList.threadQuery}'`);
              const detailProperties = getJsonSchema(detail.input, 'input').properties as Record<string, unknown> | undefined;
              const threadInput = variant.chatList.threadIdInput ?? 'threadId';
              if (!detailProperties?.[threadInput]) throw new Error(`Chat list '${name}.${variantName}' references unknown thread input '${threadInput}' on '${variant.chatList.threadQuery}'`);
              if (variant.chatList.detailVariant && !detail.views?.variants[variant.chatList.detailVariant]) throw new Error(`Chat list '${name}.${variantName}' references unknown detail variant '${variant.chatList.detailVariant}' on '${variant.chatList.threadQuery}'`);
            }
          }
          for (const [actionName, mapping] of Object.entries({ ...variant.chatActions, ...variant.chat?.actions })) {
            const actionMutation = definition.mutations?.[mapping.mutation];
            if (!actionMutation) throw new Error(`Query '${name}' action '${actionName}' references unknown mutation '${mapping.mutation}'`);
            if (actionMutation.api !== true) throw new Error(`Query '${name}' action '${actionName}' mutation '${mapping.mutation}' must be exposed to the admin API`);
            if (mapping.variant && !actionMutation.views?.variants[mapping.variant]) throw new Error(`Query '${name}' action '${actionName}' references unknown variant '${mapping.variant}' on mutation '${mapping.mutation}'`);
            const actionProperties = getJsonSchema(actionMutation.input, 'input').properties as Record<string, unknown> | undefined;
            for (const inputName of Object.keys(mapping.bind ?? {})) {
              if (!actionProperties?.[inputName]) throw new Error(`Query '${name}' action '${actionName}' binds unknown input '${inputName}' on mutation '${mapping.mutation}'`);
            }
          }
          if (kind !== 'query' && variant.renderer !== 'form' && variant.renderer !== 'json') throw new Error(`${kind} '${name}' must use a form/json renderer`);
          let rowProperties: Record<string, unknown> | undefined;
          let rowsItemSchema: unknown;
          if (variant.renderer === 'chart') {
            if (kind !== 'query' || !variant.chart || typeof variant.chart.xField !== 'string' || typeof variant.chart.yField !== 'string') throw new Error(`Chart view '${name}/${variantName}' requires a query and xField/yField configuration`);
            const output = getJsonSchema(operation.output, 'output');
            const rows = (output.properties as Record<string, unknown> | undefined)?.rows as { type?: unknown; items?: { properties?: Record<string, unknown> } } | undefined;
            if (rows?.type !== 'array' || !rows.items?.properties) throw new Error(`Chart query '${name}' must return rows[]`);
            const xField = schemaAtCollectionPath(rows.items, variant.chart.xField) as { type?: unknown } | undefined;
            const yField = schemaAtCollectionPath(rows.items, variant.chart.yField) as { type?: unknown } | undefined;
            const seriesField = variant.chart.seriesField ? schemaAtCollectionPath(rows.items, variant.chart.seriesField) : true;
            if (!xField || !yField || (yField.type !== 'number' && yField.type !== 'integer') || !seriesField) throw new Error(`Chart view '${name}/${variantName}' references invalid x/y/series fields`);
            rowProperties = rows.items.properties;
            rowsItemSchema = rows.items;
          }
          if (variant.renderer === 'table') {
            const output = getJsonSchema(operation.output, 'output');
            const outputProperties = output.properties as Record<string, unknown> | undefined;
            const rows = outputProperties?.rows as { type?: unknown; items?: { properties?: Record<string, unknown> } } | undefined;
            if (rows?.type !== 'array' || !rows.items?.properties) throw new Error(`Table query '${name}' must return a JSON Schema Page with rows[]`);
            const inputProperties = getJsonSchema(operation.input, 'input').properties as Record<string, { type?: unknown; minimum?: unknown; maximum?: unknown }> | undefined;
            const limit = inputProperties?.limit;
            if (!limit || (limit.type !== 'integer' && limit.type !== 'number') || typeof limit.minimum !== 'number' || limit.minimum < 1 || typeof limit.maximum !== 'number' || limit.maximum < limit.minimum || limit.maximum > 200) throw new Error(`Table query '${name}' input must define a bounded numeric limit of at most 200`);
            const cursorPagination = !!outputProperties?.nextCursor && inputProperties?.cursor?.type === 'string';
            const offset = inputProperties?.offset;
            const offsetPagination = !!outputProperties?.totalCount && offset?.type === 'integer' && typeof offset.minimum === 'number' && offset.minimum >= 0;
            if (!cursorPagination && !offsetPagination) throw new Error(`Table query '${name}' must declare either cursor pagination (cursor/nextCursor) or offset pagination (offset/totalCount)`);
            if (variant.collection?.paginationMode && variant.collection.paginationMode !== (cursorPagination ? 'cursor' : 'offset')) throw new Error(`Table variant '${variantName}' pagination mode does not match query '${name}' schema`);
            rowProperties = rows.items.properties;
            rowsItemSchema = rows.items;
            if (!variant.rowKey || !rowProperties[variant.rowKey]) throw new Error(`Table variant '${variantName}' must declare a rowKey present in query '${name}' output`);
            for (const column of variant.columns ?? []) if (!rowProperties[column]) throw new Error(`Table column '${column}' is not present in query '${name}' output`);
          }
          if (variant.collection) {
            const collection = variant.collection;
            if (kind !== 'query' || variant.renderer !== 'table' || !rowProperties || !rowsItemSchema) throw new Error(`Collection options on '${kind} ${name}/${variantName}' require a table query view`);
            if (!collection.itemKey || !schemaAtCollectionPath(rowsItemSchema, collection.itemKey)) throw new Error(`Collection view '${name}/${variantName}' has unknown itemKey '${collection.itemKey}'`);
            if (collection.presentation !== undefined && !['responsive', 'table', 'cards'].includes(collection.presentation)) throw new Error(`Collection view '${name}/${variantName}' has invalid presentation '${collection.presentation}'`);
            if (collection.paginationMode !== undefined && !['cursor', 'offset'].includes(collection.paginationMode)) throw new Error(`Collection view '${name}/${variantName}' has invalid pagination mode '${collection.paginationMode}'`);
            const queryInput = getJsonSchema(operation.input, 'input');
            const queryProperties = queryInput.properties as Record<string, { type?: unknown; enum?: unknown }> | undefined;
            for (const column of collection.columns) {
              const source = schemaAtCollectionPath(rowsItemSchema, column.field);
              if (!source) throw new Error(`Collection view '${name}/${variantName}' references missing result field '${column.field}'`);
              const filter = column.filter;
              if (filter) {
                if (filter.type !== 'text' && filter.type !== 'select') throw new Error(`Collection view '${name}/${variantName}' has unsupported filter type '${String(filter.type)}'`);
                const targetName = filter.targetParam ?? column.field;
                const target = queryProperties?.[targetName];
                if (!target || (filter.type === 'text' && target.type !== 'string') || (filter.type === 'select' && !Array.isArray(target.enum))) throw new Error(`Collection view '${name}/${variantName}' has incompatible filter target '${targetName}'`);
                if (((queryInput.required as string[] | undefined) ?? []).includes(targetName)) throw new Error(`Collection view '${name}/${variantName}' filter target '${targetName}' must be optional`);
              }
            }
            for (const field of [collection.titleField, collection.subtitleField]) if (field && !schemaAtCollectionPath(rowsItemSchema, field)) throw new Error(`Collection view '${name}/${variantName}' references missing presentation field '${field}'`);
            validateCollectionActions(definition, collection.actions, rowsItemSchema, `Collection view '${name}/${variantName}'`);
            if (collection.editor) {
              const editor = collection.editor;
              const mutation = definition.mutations?.[editor.mutation];
              if (!mutation || mutation.api !== true) throw new Error(`Collection view '${name}/${variantName}' references unavailable editor mutation '${editor.mutation}'`);
              if (editor.variant && !mutation.views?.variants[editor.variant]) throw new Error(`Collection view '${name}/${variantName}' references unknown editor variant '${editor.variant}'`);
              const editorInput = getJsonSchema(mutation.input, 'input');
              const editorProperties = editorInput.properties as Record<string, { type?: unknown; format?: unknown; default?: unknown }> | undefined;
              const identity = editor.identity ?? { rowField: collection.itemKey, targetInput: 'id' };
              const identitySource = schemaAtCollectionPath(rowsItemSchema, identity.rowField) as { type?: unknown; format?: unknown } | undefined;
              const identityTarget = editorProperties?.[identity.targetInput];
              if (!identitySource || !identityTarget || identitySource.type !== identityTarget.type || (identitySource.format && identityTarget.format && identitySource.format !== identityTarget.format)) throw new Error(`Collection view '${name}/${variantName}' has an invalid identity mapping '${identity.rowField} → ${identity.targetInput}'`);
              const mapped = new Set([identity.targetInput]);
              for (const column of collection.columns) {
                const targetName = column.editable === true ? column.field : typeof column.editable === 'object' ? column.editable.targetInput : undefined;
                if (!targetName) continue;
                const source = schemaAtCollectionPath(rowsItemSchema, column.field) as { type?: unknown; format?: unknown } | undefined;
                const target = editorProperties?.[targetName];
                if (!source || !target || source.type !== target.type || (source.format && target.format && source.format !== target.format)) throw new Error(`Collection view '${name}/${variantName}' has incompatible field mapping '${column.field} → ${targetName}'`);
                mapped.add(targetName);
              }
              const unmapped = ((editorInput.required as string[] | undefined) ?? []).find((key) => !mapped.has(key) && editorProperties?.[key]?.default === undefined);
              if (unmapped) throw new Error(`Collection view '${name}/${variantName}' editor requires unmapped input '${unmapped}'`);
            }
          }
          for (const action of variant.actions ?? []) {
            if (!mutationNames.has(action.mutation)) throw new Error(`UI action references unknown mutation '${action.mutation}'`);
            const target = definition.mutations?.[action.mutation];
            if (action.variant && !target?.views?.variants[action.variant]) throw new Error(`UI action references unknown variant '${action.variant}' on mutation '${action.mutation}'`);
            const mutationInput = target ? getJsonSchema(target.input, 'input').properties as Record<string, unknown> | undefined : undefined;
            for (const [field, binding] of Object.entries(action.bind ?? {})) {
              if (!mutationInput?.[field]) throw new Error(`Row action binding '${field}' is not a declared input field on mutation '${action.mutation}'`);
              if (!rowProperties?.[binding.fromRow]) throw new Error(`Row action source '${binding.fromRow}' is not present in table query '${name}' output`);
            }
          }
        }
      }
    }
  }
  for (const [name, definitionTask] of Object.entries(definition.tasks ?? {})) {
    for (const mutationName of definitionTask.triggers?.mutations ?? []) if (!mutationNames.has(mutationName)) throw new Error(`Task '${name}' triggers unknown mutation '${mutationName}'`);
    if (definitionTask.triggers?.mutations?.length && !definitionTask.triggers.mapInput) {
      const schema = (definitionTask.input as unknown as JsonSchemaProvider)['~standard'].jsonSchema?.input({ target: 'draft-2020-12' });
      const properties = schema?.properties as Record<string, unknown> | undefined;
      if (properties && Object.keys(properties).length > 0) throw new Error(`Triggered task '${name}' has input fields and must define triggers.mapInput`);
    }
  }
}

function operationAt(definition: RuntimeDefinition, kind: OperationKind, name: string) {
  return (kind === 'query' ? definition.queries : kind === 'mutation' ? definition.mutations : definition.tasks)?.[name];
}

async function readBody(request: Request, maxBytes: number): Promise<unknown> {
  const declaredSize = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new WorkcoreError('REQUEST_TOO_LARGE', 'Request body exceeds configured limit', 413);
  if (!request.body) throw new WorkcoreError('INVALID_JSON', 'Request body must be valid JSON', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new WorkcoreError('REQUEST_TOO_LARGE', 'Request body exceeds configured limit', 413);
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(buffer);
  try { return JSON.parse(text); } catch { throw new WorkcoreError('INVALID_JSON', 'Request body must be valid JSON', 400); }
}

function boundedLimit(value: string | null) { return Math.min(200, Math.max(1, Number.parseInt(value ?? '50', 10) || 50)); }
function sameScope(a: Scope, b: Scope) { return a.applicationId === b.applicationId && a.workspaceId === b.workspaceId; }
function applySchedulePatch(schedule: ScheduleEntry, patch: Record<string, unknown>) {
  if (typeof patch.enabled === 'boolean') {
    if (patch.enabled && !schedule.enabled) {
      if (schedule.kind === 'once' && schedule.runAt && Date.parse(schedule.runAt) <= Date.now()) throw new WorkcoreError('INVALID_SCHEDULE', 'A past one-off schedule cannot be re-enabled', 400);
      if (schedule.kind === 'recurring') schedule.nextRunAt = nextScheduleOccurrence(schedule.cron!, new Date(), schedule.timezone).toISOString();
    }
    schedule.enabled = patch.enabled;
  }
  if (patch.cron !== undefined) {
    if (schedule.kind !== 'recurring' || !isSupportedCron(String(patch.cron))) throw new WorkcoreError('INVALID_SCHEDULE', 'Invalid recurring cron expression', 400);
    schedule.cron = String(patch.cron);
    schedule.nextRunAt = nextScheduleOccurrence(schedule.cron, new Date(), schedule.timezone).toISOString();
  }
  if (patch.timezone !== undefined) {
    const timezone = String(patch.timezone);
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new WorkcoreError('INVALID_TIMEZONE', 'Unknown timezone', 400); }
    schedule.timezone = timezone;
    if (schedule.kind === 'recurring') schedule.nextRunAt = nextScheduleOccurrence(schedule.cron!, new Date(), timezone).toISOString();
  }
}
function normalizePath(path: string) { return `/${path.split('/').filter(Boolean).join('/')}`; }
function randomId() { return globalThis.crypto.randomUUID(); }
function encodeMemoryAgentCursor(createdAt: string, id: string) { return encodeURIComponent(`${createdAt}\u0000${id}`); }
function decodeMemoryAgentCursor(cursor: string) {
  try {
    const [createdAt, id, extra] = decodeURIComponent(cursor).split('\u0000');
    if (!createdAt || !id || extra !== undefined || !Number.isFinite(Date.parse(createdAt))) throw new TypeError();
    return [createdAt, id] as const;
  } catch { throw new TypeError('Invalid agent run cursor'); }
}
function safeMessage(error: unknown) { return error instanceof WorkcoreError ? error.message.slice(0, 300) : 'Operation failed'; }
function safeTraceValue(value: unknown): JsonValue {
  try {
    const encoded = jsonWireCodec.encode(value);
    const serialized = JSON.stringify(encoded);
    if (new TextEncoder().encode(serialized).byteLength <= 32_768) return encoded;
    return { truncated: true };
  } catch { return { unavailable: true }; }
}
async function safeHistory(options: PlatformOptions, entry: HistoryEntry): Promise<boolean> {
  try { await options.services.history.append(entry); return true; }
  catch (error) { options.services.logger?.error('Operation history persistence failed', { executionId: entry.id, detail: safeMessage(error) }); }
  return false;
}
async function cleanupContext(context: unknown, logger?: Logger) {
  if (context && typeof context === 'object' && 'dispose' in context && typeof context.dispose === 'function') {
    const dispose = context.dispose as () => unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => dispose.call(context)),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Cleanup deadline exceeded')), 5_000); }),
      ]);
    } catch { logger?.error('Application context cleanup failed', { error: 'Cleanup hook failed or exceeded 5 seconds' }); }
    finally { if (timer) clearTimeout(timer); }
  }
}
function corsHeaders(request: Request, trustedOrigins: ReadonlySet<string>): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin && !trustedOrigins.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-correlation-id, x-workcore-codec',
    'access-control-expose-headers': 'x-correlation-id',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function withCorsHeaders(response: Response, request: Request, trustedOrigins: ReadonlySet<string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(request, trustedOrigins))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(`Invalid trusted origin '${value}'`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Trusted origin must contain only an http(s) origin: '${value}'`);
  }
  return url.origin;
}
const consoleLogger: Logger = { debug: (message, fields) => console.debug(message, fields), info: (message, fields) => console.info(message, fields), warn: (message, fields) => console.warn(message, fields), error: (message, fields) => console.error(message, fields) };

function isSupportedCron(value: string) {
  const fields = value.trim().split(/\s+/);
  const bounds: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  if (fields.length !== bounds.length) return false;
  return fields.every((field, index) => field.split(',').every((part) => {
    const [minimum, maximum] = bounds[index]!;
    if (part === '*') return true;
    if (/^\*\/\d+$/.test(part)) { const step = Number(part.slice(2)); return step > 0 && step <= maximum - minimum + 1; }
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) { const start = Number(range[1]); const end = Number(range[2]); return start >= minimum && end <= maximum && start <= end; }
    if (/^\d+$/.test(part)) { const number = Number(part); return number >= minimum && number <= maximum; }
    return false;
  }));
}
export function nextScheduleOccurrence(cron: string, from: Date, timezone: string): Date {
  const parts = cron.trim().split(/\s+/);
  const matches = (part: string, value: number) => part === '*' || part.split(',').some((chunk) => {
    if (chunk.startsWith('*/')) return value % Number(chunk.slice(2)) === 0;
    if (chunk.includes('-')) { const [a, b] = chunk.split('-').map(Number); return value >= a! && value <= b!; }
    return Number(chunk) === value;
  });
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short', hourCycle: 'h23' });
  const next = new Date(from.getTime()); next.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 370; i++) {
    next.setMinutes(next.getMinutes() + 1);
    const values = Object.fromEntries(formatter.formatToParts(next).map((part) => [part.type, part.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday ?? '');
    if (matches(parts[0]!, Number(values.minute)) && matches(parts[1]!, Number(values.hour)) && matches(parts[2]!, Number(values.day)) && matches(parts[3]!, Number(values.month)) && matches(parts[4]!, weekday)) return next;
  }
  throw new Error('Could not calculate next schedule occurrence');
}

async function handleScheduleDue(options: PlatformOptions, apps: Map<string, ApplicationRegistration>) {
  const claimToken = randomId();
  const leaseMs = 30_000;
  const due = await options.services.schedules.claimDue(new Date(), claimToken, leaseMs);
  if (!due.length) return;
  const outstanding = new Map(due.map((schedule) => [schedule.id, claimToken]));
  let renewing = false;
  const renewals = setInterval(() => {
    if (renewing || !outstanding.size) return;
    renewing = true;
    const claimUntil = new Date(Date.now() + leaseMs).toISOString();
    void Promise.all([...outstanding].map(async ([id, token]) => {
      const renewed = await options.services.schedules.renewClaim(id, token, claimUntil);
      if (!renewed) outstanding.delete(id);
    })).catch((error) => options.services.logger?.error('Schedule claim renewal failed', { detail: safeMessage(error) }))
      .finally(() => { renewing = false; });
  }, Math.floor(leaseMs / 3));

  const commit = async (schedule: ScheduleEntry) => {
    if (!await options.services.schedules.updateClaimed(schedule, claimToken)) throw new WorkcoreError('SCHEDULE_CLAIM_LOST', 'Schedule reservation was lost before bookkeeping completed', 409);
    outstanding.delete(schedule.id);
  };

  try {
    for (const schedule of due) {
      let dispatchReserved = false;
      try {
        if (!schedule.pendingRunId && schedule.kind === 'recurring' && schedule.nextRunAt && Date.parse(schedule.nextRunAt) < Date.now() - 5_000) {
          schedule.lastSkipReason = 'Skipped missed recurring occurrence';
          schedule.nextRunAt = nextScheduleOccurrence(schedule.cron!, new Date(), schedule.timezone).toISOString();
          await commit(schedule);
          continue;
        }
        const registration = apps.get(schedule.scope.applicationId);
        const actor = await options.auth.resolveActor?.(schedule.actorId);
        if (!registration || !actor || !await options.services.workspaces.canAccess(actor, schedule.scope)) {
          schedule.enabled = false;
          schedule.lastSkipReason = 'Actor is unavailable or access was revoked';
          await commit(schedule);
          await safeHistory(options, { id: randomId(), scope: schedule.scope, actorId: schedule.actorId, kind: 'schedule', operation: schedule.operation, status: 'failed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: { code: 'ACCESS_REVOKED', message: 'Scheduled actor is unavailable or no longer has workspace access' } });
          continue;
        }
        const def = operationAt(registration.definition, 'task', schedule.operation);
        if (!def) {
          schedule.enabled = false;
          schedule.lastSkipReason = 'Scheduled task is no longer registered';
          await commit(schedule);
          continue;
        }
        if ((schedule.operationVersion ?? 1) !== (def.version ?? 1)) {
          schedule.enabled = false;
          schedule.lastSkipReason = 'OPERATION_VERSION_MISMATCH: drain or migrate persisted schedule inputs';
          await commit(schedule);
          await safeHistory(options, { id: randomId(), scope: schedule.scope, actorId: schedule.actorId, kind: 'schedule', operation: schedule.operation, status: 'failed', startedAt: new Date().toISOString(), error: { code: 'OPERATION_VERSION_MISMATCH', message: schedule.lastSkipReason } });
          continue;
        }
        const codec = resolveWireCodec(options, schedule.codecId ?? 'json');
        const input = decodeStored(schedule.input, schedule.codecId, options);
      await authoriseOperation(registration, def, actor, schedule.scope, input, options);
        if (!await options.services.schedules.renewClaim(schedule.id, claimToken, new Date(Date.now() + leaseMs).toISOString())) {
          throw new WorkcoreError('SCHEDULE_CLAIM_LOST', 'Schedule reservation expired before task enqueue', 409);
        }
        const runId = schedule.pendingRunId ?? `schedule:${JSON.stringify([schedule.id, schedule.nextRunAt])}`;
        if (!await options.services.schedules.reserveRun(schedule, claimToken, runId)) {
          throw new WorkcoreError('SCHEDULE_CONFLICT', 'Schedule changed before dispatch', 409);
        }
        dispatchReserved = true;
        await options.services.tasks.enqueue({ id: runId, applicationId: schedule.scope.applicationId, workspaceId: schedule.scope.workspaceId, operation: schedule.operation, operationVersion: schedule.operationVersion ?? 1, input: schedule.input, codecId: codec.id, actorId: actor.id, correlationId: randomId(), createdAt: new Date().toISOString(), scheduleId: schedule.id });
        schedule.activeRunId = runId;
        if (schedule.kind === 'once') {
          if (!await options.services.schedules.removeClaimed(schedule.id, claimToken, schedule.revision ?? 0)) throw new WorkcoreError('SCHEDULE_CLAIM_LOST', 'Schedule reservation was lost after task enqueue', 409);
          outstanding.delete(schedule.id);
        } else {
          schedule.nextRunAt = nextScheduleOccurrence(schedule.cron!, new Date(), schedule.timezone).toISOString();
          await commit(schedule);
        }
      } catch (error) {
        if (dispatchReserved || (error instanceof WorkcoreError && (error.code === 'SCHEDULE_CONFLICT' || error.code === 'SCHEDULE_CLAIM_LOST'))) {
          // Retain a reserved run ID after an uncertain enqueue/commit; never overwrite an edit.
          await options.services.schedules.releaseClaim(schedule.id, claimToken);
          outstanding.delete(schedule.id);
          options.services.logger?.warn('Schedule dispatch deferred or changed concurrently', { scheduleId: schedule.id, detail: safeMessage(error) });
          continue;
        }
        if (outstanding.has(schedule.id)) {
          schedule.lastSkipReason = safeMessage(error);
          if (schedule.kind === 'once') schedule.enabled = false;
          else schedule.nextRunAt = nextScheduleOccurrence(schedule.cron!, new Date(), schedule.timezone).toISOString();
          try { await commit(schedule); }
          catch (bookkeepingError) {
            await options.services.schedules.releaseClaim(schedule.id, claimToken).catch((releaseError) => options.services.logger?.error('Could not release schedule claim', { scheduleId: schedule.id, detail: safeMessage(releaseError) }));
            outstanding.delete(schedule.id);
            options.services.logger?.error('Could not persist schedule failure bookkeeping', { scheduleId: schedule.id, detail: safeMessage(bookkeepingError) });
          }
          await safeHistory(options, { id: randomId(), scope: schedule.scope, actorId: schedule.actorId, kind: 'schedule', operation: schedule.operation, status: 'failed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: { code: error instanceof WorkcoreError ? error.code : 'SCHEDULE_FAILED', message: safeMessage(error) } });
        } else options.services.logger?.error('Schedule processing failed after reservation was finalized', { scheduleId: schedule.id, detail: safeMessage(error) });
      }
    }
  } finally {
    clearInterval(renewals);
    await Promise.all([...outstanding].map(async ([id, token]) => {
      try { await options.services.schedules.releaseClaim(id, token); }
      catch (error) { options.services.logger?.error('Could not release unfinished schedule claim', { scheduleId: id, detail: safeMessage(error) }); }
    }));
  }
}

// In-memory adapters are intended for tests and local demos, not durable production storage.
/** Shared in-memory adapter state. Compose its individual services when building PlatformServices. */
export function createMemoryState(options: { workspaces?: Array<{ applicationId: string; id: string; name: string; actors: string[] }> } = {}): PlatformServices {
  const workspaceRows = options.workspaces ?? [];
  const eventListeners = new Map<string, Set<(event: WorkcoreEvent) => void>>();
  const taskQueue: TaskPayload[] = [];
  const processing = new Map<string, TaskPayload>();
  const taskRuns = new Map<string, TaskRun>();
  const agentRuns = new Map<string, AgentRun>();
  const agentEvents = new Map<string, AgentTraceEvent[]>();
  const historyRows = new Map<string, HistoryEntry[]>();
  const scheduleRows = new Map<string, ScheduleEntry>();
  const kvRows = new Map<string, unknown>();
  const waiters = new Set<() => void>();
  const scopeKey = (scope: Scope) => JSON.stringify([scope.applicationId, scope.workspaceId]);
  const kvKey = (scope: Scope, key: string) => JSON.stringify([scope.applicationId, scope.workspaceId, key]);
  const services: PlatformServices = {
    workspaces: {
      canAccess: (actor, scope) => workspaceRows.some((workspace) => workspace.applicationId === scope.applicationId && workspace.id === scope.workspaceId && workspace.actors.includes(actor.id)),
      list: async (actor, applicationId) => workspaceRows.filter((workspace) => workspace.applicationId === applicationId && workspace.actors.includes(actor.id)).map(({ id, name }) => ({ id, name })),
    },
    events: {
      publish: async (event) => { for (const listener of eventListeners.get(scopeKey(event)) ?? []) listener(event); },
      subscribe: (scope, listener) => { const key = scopeKey(scope); const listeners = eventListeners.get(key) ?? new Set(); listeners.add(listener); eventListeners.set(key, listeners); return () => { listeners.delete(listener); if (!listeners.size) eventListeners.delete(key); }; },
    },
    history: {
      append: async (entry) => { const key = scopeKey(entry.scope); const entries = historyRows.get(key) ?? []; entries.unshift(entry); historyRows.set(key, entries); },
      list: async (scope, limit) => (historyRows.get(scopeKey(scope)) ?? []).slice(0, limit),
    },
    tasks: {
      enqueue: async (payload) => { if (taskRuns.has(payload.id)) return; taskQueue.push(payload); taskRuns.set(payload.id, { id: payload.id, runId: payload.id, scope: { applicationId: payload.applicationId, workspaceId: payload.workspaceId }, actorId: payload.actorId, kind: 'task', operation: payload.operation, status: 'queued', startedAt: payload.createdAt, ...(payload.codecId ? { codecId: payload.codecId } : {}) }); for (const wake of waiters) wake(); },
      claim: async () => { const item = taskQueue.shift(); if (item) { processing.set(item.id, item); const run = taskRuns.get(item.id); if (run) { run.status = 'running'; run.startedAt = new Date().toISOString(); } } return item; },
      release: async (id) => { const run = taskRuns.get(id); if (!run || run.status !== 'running') return; run.status = 'queued'; delete run.finishedAt; const item = processing.get(id); if (item) { processing.delete(id); taskQueue.unshift(item); for (const wake of waiters) wake(); } },
      complete: async (id, result) => { processing.delete(id); const run = taskRuns.get(id); if (run) { run.status = 'succeeded'; run.finishedAt = new Date().toISOString(); run.result = result; } },
      fail: async (id, error) => { processing.delete(id); const run = taskRuns.get(id); if (run) { run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = error; } },
      progress: async (id, progress) => { const run = taskRuns.get(id); if (run) run.progress = Math.max(0, Math.min(100, progress)); },
      list: async (scope, limit) => [...taskRuns.values()].filter((run) => sameScope(run.scope, scope)).slice(0, limit),
      waitForWork: (signal) => new Promise((resolve) => { if (signal.aborted) return resolve(); const wake = () => { waiters.delete(wake); signal.removeEventListener('abort', wake); resolve(); }; waiters.add(wake); signal.addEventListener('abort', wake, { once: true }); }),
    },
    agentRuns: {
      create: async (run) => { if (agentRuns.has(run.id)) throw new Error(`Duplicate agent run '${run.id}'`); agentRuns.set(run.id, structuredClone(run)); agentEvents.set(run.id, []); },
      get: async (scope, runId) => { const run = agentRuns.get(runId); return run && sameScope(run.scope, scope) ? structuredClone(run) : undefined; },
      list: async (scope, filter) => {
        let rows = [...agentRuns.values()].filter((run) => sameScope(run.scope, scope)
          && (!filter.agent || run.agent === filter.agent) && (!filter.status || run.status === filter.status)
          && (!filter.actorId || run.actorId === filter.actorId) && (!filter.conversationId || run.conversationId === filter.conversationId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        if (filter.cursor) {
          const [createdAt, id] = decodeMemoryAgentCursor(filter.cursor);
          rows = rows.filter((run) => run.createdAt < createdAt || (run.createdAt === createdAt && run.id < id));
        }
        const page = rows.slice(0, filter.limit);
        const last = page.at(-1);
        return { runs: structuredClone(page), nextCursor: rows.length > page.length && last ? encodeMemoryAgentCursor(last.createdAt, last.id) : null };
      },
      update: async (run) => { const existing = agentRuns.get(run.id); if (!existing || !sameScope(existing.scope, run.scope)) throw new Error(`Unknown agent run '${run.id}'`); agentRuns.set(run.id, structuredClone(run)); },
      appendEvent: async (event) => { const run = agentRuns.get(event.runId); if (!run) throw new Error(`Unknown agent run '${event.runId}'`); const rows = agentEvents.get(event.runId) ?? []; if (rows.some((item) => item.sequence === event.sequence)) return; rows.push(structuredClone(event)); agentEvents.set(event.runId, rows); },
      listEvents: async (scope, runId, afterSequence, limit) => { const run = agentRuns.get(runId); if (!run || !sameScope(run.scope, scope)) return []; return structuredClone((agentEvents.get(runId) ?? []).filter((event) => event.sequence > afterSequence).slice(0, limit)); },
    },
    schedules: {
      create: async (schedule) => { scheduleRows.set(schedule.id, structuredClone(schedule)); },
      list: async (scope) => structuredClone([...scheduleRows.values()].filter((schedule) => sameScope(schedule.scope, scope))),
      get: async (id) => { const schedule = scheduleRows.get(id); return schedule ? structuredClone(schedule) : undefined; },
      update: async (schedule) => {
        const current = scheduleRows.get(schedule.id);
        if (!current || (current.revision ?? 0) !== (schedule.revision ?? 0)) return false;
        const { claimToken: _token, claimUntil: _until, activeRunId: _active, pendingRunId: _pending, ...fields } = schedule;
        scheduleRows.set(schedule.id, structuredClone({ ...current, ...fields, revision: (current.revision ?? 0) + 1 }));
        return true;
      },
      remove: async (id) => { scheduleRows.delete(id); },
      claimDue: async (now, claimToken, leaseMs) => {
        const due: ScheduleEntry[] = [];
        for (const schedule of scheduleRows.values()) {
          if (!schedule.pendingRunId && (!schedule.enabled || !schedule.nextRunAt || Date.parse(schedule.nextRunAt) > now.getTime())) continue;
          if (schedule.claimToken && schedule.claimUntil && Date.parse(schedule.claimUntil) > now.getTime()) continue;
          if (!schedule.pendingRunId && schedule.activeRunId) {
            const run = taskRuns.get(schedule.activeRunId);
            if (run?.status === 'queued' || run?.status === 'running') {
              schedule.lastSkipReason = 'Skipped because the previous scheduled run is still active';
              if (schedule.kind === 'recurring') schedule.nextRunAt = nextScheduleOccurrence(schedule.cron!, now, schedule.timezone).toISOString();
              continue;
            }
            delete schedule.activeRunId;
          }
          schedule.claimToken = claimToken;
          schedule.claimUntil = new Date(now.getTime() + leaseMs).toISOString();
          due.push({ ...schedule });
        }
        return due;
      },
      renewClaim: async (id, claimToken, claimUntil) => {
        const schedule = scheduleRows.get(id);
        if (!schedule || schedule.claimToken !== claimToken) return false;
        schedule.claimUntil = claimUntil;
        return true;
      },
      reserveRun: async (schedule, claimToken, runId) => {
        const current = scheduleRows.get(schedule.id);
        if (!current || (!current.enabled && !current.pendingRunId) || current.claimToken !== claimToken || (current.revision ?? 0) !== (schedule.revision ?? 0)
          || !current.claimUntil || Date.parse(current.claimUntil) <= Date.now()) return false;
        current.pendingRunId = runId;
        return true;
      },
      clearActiveRun: async (id, runId) => {
        const current = scheduleRows.get(id);
        if (current?.activeRunId === runId) delete current.activeRunId;
      },
      updateClaimed: async (schedule, claimToken) => {
        const current = scheduleRows.get(schedule.id);
        if (!current || current.claimToken !== claimToken || (current.revision ?? 0) !== (schedule.revision ?? 0)) return false;
        const updated = { ...schedule, revision: (current.revision ?? 0) + 1 };
        delete updated.claimToken;
        delete updated.claimUntil;
        delete updated.pendingRunId;
        scheduleRows.set(updated.id, updated);
        return true;
      },
      removeClaimed: async (id, claimToken, revision = 0) => {
        const current = scheduleRows.get(id);
        if (!current || current.claimToken !== claimToken || (current.revision ?? 0) !== revision) return false;
        scheduleRows.delete(id);
        return true;
      },
      releaseClaim: async (id, claimToken) => {
        const schedule = scheduleRows.get(id);
        if (schedule?.claimToken !== claimToken) return;
        delete schedule.claimToken;
        delete schedule.claimUntil;
      },
    },
    kv: { get: async (scope, key) => kvRows.get(kvKey(scope, key)), set: async (scope, key, value) => { kvRows.set(kvKey(scope, key), value); }, delete: async (scope, key) => { kvRows.delete(kvKey(scope, key)); } },
    logger: consoleLogger,
  };
  return services;
}

export type ClientDefinition<D> = D;
