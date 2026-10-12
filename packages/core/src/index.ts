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
};

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
}

export interface UiVariant {
  title: string;
  subtitle?: string;
  helpText?: string;
  renderer: 'table' | 'json' | 'form';
  rowKey?: string;
  columns?: readonly string[];
  actions?: readonly {
    label: string;
    mutation: string;
    variant?: string;
    bind?: Record<string, { fromRow: string }>;
  }[];
  layout?: Record<string, unknown>;
}

export interface UiMetadata {
  default: string;
  variants: Record<string, UiVariant>;
}

type CommonDefinition<App, S extends AnySchema, O extends AnySchema, Kind extends OperationKind, Tools = OperationCaller> = {
  input: S;
  output: O;
  permission?: Permission<App, OutputOf<S>>;
  api?: boolean;
  ui?: UiMetadata;
  handler: (args: OperationCallContext<App, OutputOf<S>, Tools>) => OutputOf<O> | Promise<OutputOf<O>>;
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
  queries?: Record<string, QueryDefinition<App>>;
  mutations?: Record<string, MutationDefinition<App>>;
  tasks?: Record<string, TaskDefinition<App>>;
};

export type WorkspaceDefinition<App, D extends { id: string } = { id: string }> = D & {
  readonly __appContext?: App;
  registerApplication(options: ApplicationRegistrationOptions<WorkspaceDefinition<App, D>>): ApplicationRegistration;
};

type SchemaArg<S extends AnySchema, O extends AnySchema> = { input: S; output: O };
type QueryOptions<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller> = SchemaArg<S, O> & Omit<CommonDefinition<App, S, O, 'query', Tools>, 'input' | 'output' | 'kind'>;
type MutationOptions<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller> = SchemaArg<S, O> & Omit<CommonDefinition<App, S, O, 'mutation', Tools>, 'input' | 'output' | 'kind'>;
type TaskOptions<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller> = SchemaArg<S, O> & Omit<CommonDefinition<App, S, O, 'task', Tools>, 'input' | 'output' | 'kind'> & { triggers?: { mutations?: readonly string[]; mapInput?: (event: WorkcoreEvent) => InputOf<S> } };

type SchemaInput<S> = S extends AnySchema ? InputOf<S> : never;
type SchemaOutput<S> = S extends AnySchema ? OutputOf<S> : never;
type MutationSuccessEvent<Names extends string> = Omit<WorkcoreEvent, 'operation' | 'type'> & { type: 'mutation.succeeded'; operation: Names };
type UiActionFor<Mutations extends object> = {
  [Name in keyof Mutations & string]: Omit<NonNullable<UiVariant['actions']>[number], 'mutation' | 'bind'> & {
    mutation: Name;
    bind?: SchemaInput<Mutations[Name]> extends object
      ? Partial<Record<keyof SchemaInput<Mutations[Name]> & string, { fromRow: string }>>
      : never;
  };
}[keyof Mutations & string];
type UiMetadataFor<Mutations extends object> = Omit<UiMetadata, 'variants'> & {
  variants: Record<string, Omit<UiVariant, 'actions'> & { actions?: readonly UiActionFor<Mutations>[] }>;
};

type DefinitionOperationCaller<
  Queries extends object, QueryOutputs extends Record<keyof Queries, unknown>,
  Mutations extends object, MutationOutputs extends Record<keyof Mutations, unknown>,
  Tasks extends object, TaskOutputs extends Record<keyof Tasks, unknown>,
> = {
  query<N extends keyof Queries & string>(name: N, input: SchemaInput<Queries[N]>): Promise<QueryOutputs[N]>;
  mutate<N extends keyof Mutations & string>(name: N, input: SchemaInput<Mutations[N]>): Promise<MutationOutputs[N]>;
  enqueue<N extends keyof Tasks & string>(name: N, input: SchemaInput<Tasks[N]>): Promise<{ runId: string }>;
};

type DefinitionOperationMap<
  App, Inputs extends object, Outputs extends Record<keyof Inputs, unknown>, Tools, Kind extends OperationKind, Mutations extends object,
> = {
  [K in keyof Inputs]: {
    input: Inputs[K];
    output: ValidationSchema<unknown, Outputs[K]>;
    permission?: Permission<App, SchemaOutput<NoInfer<Inputs[K]>>>;
    api?: boolean;
    ui?: UiMetadataFor<Mutations>;
    handler: (args: OperationCallContext<App, SchemaOutput<NoInfer<Inputs[K]>>, Tools>) => NoInfer<Outputs[K]> | Promise<NoInfer<Outputs[K]>>;
    readonly kind?: Kind;
  } & (Kind extends 'task' ? { triggers?: { mutations?: readonly (keyof Mutations & string)[]; mapInput?: (event: MutationSuccessEvent<keyof Mutations & string>) => SchemaInput<NoInfer<Inputs[K]>> } } : {});
} & {
  [K in keyof Outputs]: { output: ValidationSchema<unknown, Outputs[K]> };
};

type DefinedOperationMap<
  App, Inputs extends object, Outputs extends Record<keyof Inputs, unknown>, Tools, Kind extends OperationKind, Mutations extends object,
> = {
  [K in keyof Inputs]: {
    input: Inputs[K];
    output: ValidationSchema<unknown, Outputs[K]>;
    permission?: Permission<App, SchemaOutput<Inputs[K]>>;
    api?: boolean;
    ui?: UiMetadataFor<Mutations>;
    handler: (args: OperationCallContext<App, SchemaOutput<Inputs[K]>, Tools>) => Outputs[K] | Promise<Outputs[K]>;
    readonly kind: Kind;
  } & (Kind extends 'task' ? { triggers?: { mutations?: readonly (keyof Mutations & string)[]; mapInput?: (event: MutationSuccessEvent<keyof Mutations & string>) => SchemaInput<Inputs[K]> } } : {});
};

type DefinedWorkspace<App, Id extends string,
  Queries extends object, QueryOutputs extends Record<keyof Queries, unknown>,
  Mutations extends object, MutationOutputs extends Record<keyof Mutations, unknown>,
  Tasks extends object, TaskOutputs extends Record<keyof Tasks, unknown>,
  AuthSchema extends AnySchema | undefined,
> = {
  id: Id;
  queries: DefinedOperationMap<App, Queries, QueryOutputs, DefinitionOperationCaller<Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs>, 'query', Mutations>;
  mutations: DefinedOperationMap<App, Mutations, MutationOutputs, DefinitionOperationCaller<Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs>, 'mutation', Mutations>;
  tasks: DefinedOperationMap<App, Tasks, TaskOutputs, DefinitionOperationCaller<Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs>, 'task', Mutations>;
} & ([AuthSchema] extends [undefined]
  ? { authorization?: undefined }
  : AuthSchema extends AnySchema ? { authorization: AuthorizationConfiguration<AuthSchema> } : never);

type WorkspaceConfiguration<App, Id extends string,
  Queries extends object, QueryOutputs extends Record<keyof Queries, unknown>,
  Mutations extends object, MutationOutputs extends Record<keyof Mutations, unknown>,
  Tasks extends object, TaskOutputs extends Record<keyof Tasks, unknown>,
  AuthSchema extends AnySchema | undefined,
> = {
  id: Id;
  authorization?: AuthSchema extends AnySchema ? AuthorizationConfiguration<AuthSchema> : undefined;
  queries?: DefinitionOperationMap<App, Queries, QueryOutputs, DefinitionOperationCaller<NoInfer<Queries>, NoInfer<QueryOutputs>, NoInfer<Mutations>, NoInfer<MutationOutputs>, NoInfer<Tasks>, NoInfer<TaskOutputs>>, 'query', NoInfer<Mutations>>;
  mutations?: DefinitionOperationMap<App, Mutations, MutationOutputs, DefinitionOperationCaller<NoInfer<Queries>, NoInfer<QueryOutputs>, NoInfer<Mutations>, NoInfer<MutationOutputs>, NoInfer<Tasks>, NoInfer<TaskOutputs>>, 'mutation', NoInfer<Mutations>>;
  tasks?: DefinitionOperationMap<App, Tasks, TaskOutputs, DefinitionOperationCaller<NoInfer<Queries>, NoInfer<QueryOutputs>, NoInfer<Mutations>, NoInfer<MutationOutputs>, NoInfer<Tasks>, NoInfer<TaskOutputs>>, 'task', NoInfer<Mutations>>;
};

function withOperationKind(operations: object | undefined, kind: OperationKind): Record<string, RuntimeOperation> {
  return Object.fromEntries(Object.entries(operations ?? {}).map(([name, operation]) => [name, { ...(operation as object), kind }])) as Record<string, RuntimeOperation>;
}

export function defineWorkspace<App>() {
  return <
    const Id extends string,
    const Queries extends object = {}, QueryOutputs extends Record<keyof Queries, unknown> = { [K in keyof Queries]: never },
    const Mutations extends object = {}, MutationOutputs extends Record<keyof Mutations, unknown> = { [K in keyof Mutations]: never },
    const Tasks extends object = {}, TaskOutputs extends Record<keyof Tasks, unknown> = { [K in keyof Tasks]: never },
    const AuthSchema extends AnySchema | undefined = undefined,
  >(definition: WorkspaceConfiguration<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, AuthSchema>): WorkspaceDefinition<App, DefinedWorkspace<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, AuthSchema>> => {
    const queries = withOperationKind(definition.queries, 'query');
    const mutations = withOperationKind(definition.mutations, 'mutation');
    const tasks = withOperationKind(definition.tasks, 'task');
    const runtimeDefinition: RuntimeDefinition = {
      id: definition.id,
      ...(definition.authorization === undefined ? {} : { authorization: definition.authorization as AuthorizationDefinition }),
      queries,
      mutations,
      tasks: tasks as NonNullable<RuntimeDefinition['tasks']>,
    };
    validateDefinition(runtimeDefinition);
    const workspace = { ...definition, queries, mutations, tasks };
    Object.defineProperty(workspace, 'registerApplication', {
      enumerable: false,
      value: (options: ApplicationRegistrationOptions<WorkspaceDefinition<App, DefinedWorkspace<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, AuthSchema>>>) => registerApplicationInternal<WorkspaceDefinition<App, DefinedWorkspace<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, AuthSchema>>>(runtimeDefinition, options),
    });
    return workspace as unknown as WorkspaceDefinition<App, DefinedWorkspace<App, Id, Queries, QueryOutputs, Mutations, MutationOutputs, Tasks, TaskOutputs, AuthSchema>>;
  };
}

export function query<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: QueryOptions<App, S, O, Tools>): QueryDefinition<App, S, O, Tools> {
  return { ...options, kind: 'query' };
}
export function tableQuery<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: QueryOptions<App, S, O, Tools>): QueryDefinition<App, S, O, Tools> {
  return { ...options, kind: 'query' };
}
export function mutation<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: MutationOptions<App, S, O, Tools>): MutationDefinition<App, S, O, Tools> {
  return { ...options, kind: 'mutation' };
}
export function task<App, S extends AnySchema, O extends AnySchema, Tools = OperationCaller>(options: TaskOptions<App, S, O, Tools>): TaskDefinition<App, S, O, Tools> {
  return { ...options, kind: 'task' };
}

type OperationsFor<D, K extends OperationKind> = K extends 'query'
  ? D extends { queries?: infer Q } ? NonNullable<Q> : {}
  : K extends 'mutation'
    ? D extends { mutations?: infer M } ? NonNullable<M> : {}
    : D extends { tasks?: infer T } ? NonNullable<T> : {};
export type QueryNames<D> = keyof OperationsFor<D, 'query'> & string;
export type MutationNames<D> = keyof OperationsFor<D, 'mutation'> & string;
export type TaskNames<D> = keyof OperationsFor<D, 'task'> & string;
export type DefinitionAt<D, K extends OperationKind, N extends string> = N extends keyof OperationsFor<D, K> ? OperationsFor<D, K>[N] : never;

export type InputFor<Def> = Def extends { input: infer S } ? InputOf<S> : never;
export type OutputFor<Def> = Def extends { output: infer S } ? OutputOf<S> : never;

export type RuntimeDefinition = {
  id: string;
  authorization?: AuthorizationDefinition;
  queries?: Record<string, RuntimeOperation>;
  mutations?: Record<string, RuntimeOperation>;
  tasks?: Record<string, RuntimeOperation & { triggers?: { mutations?: readonly string[]; mapInput?: (event: WorkcoreEvent) => unknown } }>;
};

export type RuntimeOperation = {
  kind: OperationKind;
  input: AnySchema;
  output: AnySchema;
  permission?: Permission<unknown, unknown>;
  api?: boolean;
  ui?: UiMetadata;
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
  ? { resolveAuthorization: (args: { scope: Scope; actor: Actor }) => (S extends AnySchema ? OutputOf<S> : never) | Promise<S extends AnySchema ? OutputOf<S> : never> }
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
  /** Maximum time worker.stop() waits after aborting work. Defaults to 10 seconds. */
  shutdownTimeoutMs?: number;
  liveRefreshMs?: number;
  workerRetryDelayMs?: number;
  /** Additional allow-listed codecs for request/response values and encoded queue/schedule inputs. */
  wireCodecs?: readonly WireCodec[];
};

export function createPlatform(options: PlatformOptions) {
  const apps = new Map(options.applications.map((registration) => [registration.definition.id, registration]));
  const trustedOrigins = new Set((options.trustedOrigins ?? []).map(normalizeOrigin));
  const codecs = new Set<string>();
  for (const codec of options.wireCodecs ?? []) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(codec.id) || codec.id === jsonWireCodec.id || codecs.has(codec.id)) throw new Error(`Invalid or duplicate wire codec id '${codec.id}'`);
    codecs.add(codec.id);
  }
  if (apps.size !== options.applications.length) throw new Error('Application IDs must be unique');
  for (const registration of options.applications) validateDefinition(registration.definition);

  const worker = () => createWorker(options, apps);
  const httpHandler = (mount: { apiBasePath?: string; admin?: { basePath: string; handle?: (request: Request) => Promise<Response> | Response } } = {}) => {
    const apiBasePath = normalizePath(mount.apiBasePath ?? '/workcore/api');
    const adminPath = mount.admin?.basePath ?? options.admin?.basePath;
    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (adminPath && (url.pathname === adminPath || url.pathname.startsWith(`${adminPath}/`))) {
        if (options.admin?.handle) return options.admin.handle(request);
        if (mount.admin && 'handle' in mount.admin && mount.admin.handle) return mount.admin.handle(request);
        return json({ error: { code: 'ADMIN_ASSETS_NOT_CONFIGURED', message: 'Install @workcore/admin and provide its createAdminHandler() for this route' } }, 501);
      }
      if (!url.pathname.startsWith(`${apiBasePath}/`) && url.pathname !== apiBasePath) return new Response('Not found', { status: 404 });
      let codec = jsonWireCodec;
      try {
        codec = resolveWireCodec(options, request.headers.get('x-workcore-codec'));
        const response = await handleApi(request, url, apiBasePath, options, apps, trustedOrigins, codec);
        return withCorsHeaders(response, request, trustedOrigins);
      } catch (error) {
        const known = error instanceof WorkcoreError ? error : new WorkcoreError('INTERNAL_ERROR', 'The operation could not be completed', 500);
        options.services.logger?.error('Workcore request failed', { code: known.code, detail: error instanceof Error ? error.message : String(error) });
        const responseCodec = known.code === 'WIRE_CODEC_UNSUPPORTED' ? jsonWireCodec : codec;
        try { return withCorsHeaders(json({ error: { code: known.code, message: known.message } }, known.status, {}, responseCodec), request, trustedOrigins); }
        catch { return withCorsHeaders(json({ error: { code: 'WIRE_ENCODING_FAILED', message: 'The error response could not be encoded' } }, 500), request, trustedOrigins); }
      }
    };
  };
  return { httpHandler, worker };
}

class WorkcoreError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
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
    return json({ runs: runs.map((run) => ({ ...run, ...(run.result === undefined ? {} : { result: decodeStored(run.result, run.codecId, options) }) })) }, 200, {}, codec);
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
    const schedule: ScheduleEntry = { id: randomId(), scope, operation, input: codec.encode(validated), codecId: codec.id, actorId: actor.id, timezone, kind, enabled: true, createdAt: new Date().toISOString(), ...(runAt ? { runAt, nextRunAt: runAt } : { cron: String(item.cron), nextRunAt: nextScheduleOccurrence(String(item.cron), new Date(), timezone).toISOString() }) };
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
    const schedule = await options.services.schedules.get(id);
    if (!schedule || !sameScope(schedule.scope, scope)) throw new WorkcoreError('NOT_FOUND', 'Schedule not found', 404);
    const patch = body as Record<string, unknown>;
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
    if (!await options.services.schedules.update(schedule)) throw new WorkcoreError('SCHEDULE_CONFLICT', 'Schedule changed concurrently; reload and retry', 409);
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
      await options.services.tasks.enqueue({ id: runId, applicationId, workspaceId, operation: operationName, input: codec.encode(validatedInput), codecId: codec.id, actorId: actor.id, correlationId, createdAt: new Date().toISOString() });
      return json({ runId }, 202, {}, codec);
    }
    const executionId = randomId();
    const correlationId = request.headers.get('x-correlation-id') ?? randomId();
    const startedAt = Date.now();
    const entry: HistoryEntry = { id: executionId, scope, actorId: actor.id, kind, operation: operationName, status: 'running', startedAt: new Date(startedAt).toISOString() };
    let context: unknown;
    try {
      context = await registration.createAppContext({ scope, actor });
      const result = await executeWithDeadline(request.signal, options.operationTimeoutMs ?? 30_000, (signal) => def.handler({
        ctx: createExecutionContext(scope, actor, correlationId, context, options.services, signal),
        input: validatedInput,
        operations: createCaller(registration, actor, scope, correlationId, options, apps, signal, codec),
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
      return json({ result: validatedResult, executionId, ...(deliveryWarnings.length ? { deliveryWarning: deliveryWarnings[0], deliveryWarnings } : {}) }, 200, {}, codec);
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
  const result = await schema['~standard'].validate(value) as { value?: unknown; issues?: readonly { message: string }[] };
  if (result.issues) throw new WorkcoreError('VALIDATION_FAILED', result.issues.map((issue) => issue.message).join('; '), 400);
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

function createExecutionContext(scope: Scope, actor: Actor, correlationId: string, app: unknown, services: PlatformServices, signal: AbortSignal, runId?: string): ExecutionContext<unknown> {
  return {
    scope, actor, correlationId, signal, app,
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

function createCaller(registration: ApplicationRegistration, actor: Actor, scope: Scope, correlationId: string, options: PlatformOptions, apps: Map<string, ApplicationRegistration>, signal: AbortSignal, codec: WireCodec = jsonWireCodec, causationId?: string, triggerDepth = 0, currentExecutionId?: string): OperationCaller {
  const invoke = async (kind: 'query' | 'mutation' | 'task', name: string, input: unknown) => {
    if (!await options.services.workspaces.canAccess(actor, scope)) throw new WorkcoreError('FORBIDDEN', 'Workspace access denied', 403);
    const def = operationAt(registration.definition, kind, name);
    if (!def) throw new WorkcoreError('OPERATION_NOT_FOUND', `Unknown ${kind}: ${name}`, 404);
    const validInput = await validate(def.input, input);
    await authoriseOperation(registration, def, actor, scope, validInput, options);
    if (kind === 'task') {
      if (triggerDepth >= 8) throw new WorkcoreError('TRIGGER_DEPTH_EXCEEDED', 'Background operation trigger depth limit exceeded', 409);
      const id = randomId();
      await options.services.tasks.enqueue({ id, applicationId: scope.applicationId, workspaceId: scope.workspaceId, operation: name, input: encodeWithCodec(codec, validInput), codecId: codec.id, actorId: actor.id, correlationId, ...(currentExecutionId ? { causationId: currentExecutionId } : causationId ? { causationId } : {}), triggerDepth: triggerDepth + 1, createdAt: new Date().toISOString() });
      return { runId: id };
    }
    const executionId = randomId();
    const startedAt = Date.now();
    const entry: HistoryEntry = { id: executionId, scope, actorId: actor.id, kind, operation: name, status: 'running', startedAt: new Date(startedAt).toISOString() };
    const context = await registration.createAppContext({ scope, actor });
    try {
      const result = await executeWithDeadline(signal, options.operationTimeoutMs ?? 30_000, (executionSignal) => def.handler({ ctx: createExecutionContext(scope, actor, correlationId, context, options.services, executionSignal), input: validInput, operations: createCaller(registration, actor, scope, correlationId, options, apps, executionSignal, codec, causationId, triggerDepth, currentExecutionId) }));
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
  return { query: (name, input) => invoke('query', name, input), mutate: (name, input) => invoke('mutation', name, input), enqueue: (name, input) => invoke('task', name, input) as Promise<{ runId: string }> };
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
      operation, input: encodeWithCodec(codec, input), codecId: codec.id, actorId: actor.id, correlationId, causationId: event.id, triggerDepth: (event.triggerDepth ?? 0) + 1, createdAt: new Date().toISOString(),
    });
  }
}

async function processClaimedTask(payload: TaskPayload, options: PlatformOptions, apps: Map<string, ApplicationRegistration>, signal: AbortSignal) {
  const registration = apps.get(payload.applicationId);
  if (!registration || !options.auth.resolveActor) {
    await recordTaskFailure(options, payload, { code: 'ACTOR_UNAVAILABLE', message: 'Task actor cannot be resolved by configured auth adapter' });
    return;
  }
  const actor = await options.auth.resolveActor(payload.actorId);
  const scope = { applicationId: payload.applicationId, workspaceId: payload.workspaceId };
  if (!actor || !await options.services.workspaces.canAccess(actor, scope)) {
    await recordTaskFailure(options, payload, { code: 'ACCESS_REVOKED', message: 'Task actor no longer has workspace access' });
    return;
  }
  const def = operationAt(registration.definition, 'task', payload.operation);
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
      result = await executeWithDeadline(signal, options.operationTimeoutMs ?? 5 * 60_000, (executionSignal) => def.handler({
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
          if (event.type !== 'mutation.succeeded' && event.type !== 'task.succeeded') return;
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
  const visibleMutations = new Set<string>();
  for (const [name, def] of Object.entries(definition.mutations ?? {})) {
    if (def.api === true && await permissionVisible(registration, def, actor, scope, options)) visibleMutations.add(name);
  }
  for (const [kind, map] of [['query', definition.queries], ['mutation', definition.mutations], ['task', definition.tasks]] as const) {
    for (const [name, def] of Object.entries(map ?? {})) {
      if (def.api !== true || !await permissionVisible(registration, def, actor, scope, options)) continue;
      const inputSchema = getJsonSchema(def.input, 'input');
      const outputSchema = getJsonSchema(def.output, 'output');
      const ui = def.ui ? {
        ...def.ui,
        variants: Object.fromEntries(Object.entries(def.ui.variants).map(([variantName, variant]) => [variantName, {
          ...variant,
          ...(variant.actions ? { actions: variant.actions.filter((action) => visibleMutations.has(action.mutation)) } : {}),
        }])),
      } : null;
      operations.push({ name, kind, input: inputSchema, output: outputSchema, ui });
    }
  }
  return { protocolVersion: 1, schemaDialect: 'https://json-schema.org/draft/2020-12/schema', applicationId: definition.id, operations };
}

async function permissionVisible(registration: ApplicationRegistration, definition: RuntimeOperation, actor: Actor, scope: Scope, options: PlatformOptions) {
  if (definition.permission === undefined) return false;
  // Input-aware policies are decided at execution; an empty list explicitly requires no capability.
  if (typeof definition.permission === 'function' || (Array.isArray(definition.permission) && definition.permission.length === 0)) return true;
  const permissions = typeof definition.permission === 'string' ? [definition.permission] : definition.permission;
  for (const permission of permissions) if (!await canCapability(registration, options, actor, scope, permission, undefined)) return false;
  return true;
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
  if (definition.authorization && (!definition.authorization.context?.['~standard']?.validate || typeof definition.authorization.check !== 'function')) throw new Error('Application authorization must provide a Standard Schema context and check function');
  const mutationNames = new Set(Object.keys(definition.mutations ?? {}));
  for (const [kind, operations] of [['query', definition.queries], ['mutation', definition.mutations], ['task', definition.tasks]] as const) {
    for (const [name, operation] of Object.entries(operations ?? {})) {
      if (!operation.input?.['~standard']?.validate || !operation.output?.['~standard']?.validate) throw new Error(`${kind} '${name}' must provide Standard Schema input and output`);
      if (operation.api === true) {
        getJsonSchema(operation.input, 'input');
        getJsonSchema(operation.output, 'output');
      }
      if (operation.ui) {
        if (!operation.ui.variants[operation.ui.default]) throw new Error(`${kind} '${name}' default UI variant '${operation.ui.default}' does not exist`);
        for (const [variantName, variant] of Object.entries(operation.ui.variants)) {
          if (kind === 'query' && variant.renderer === 'form') throw new Error(`Query '${name}' cannot use form renderer '${variantName}'`);
          if (kind !== 'query' && variant.renderer !== 'form' && variant.renderer !== 'json') throw new Error(`${kind} '${name}' must use a form/json renderer`);
          let rowProperties: Record<string, unknown> | undefined;
          if (variant.renderer === 'table') {
            const output = getJsonSchema(operation.output, 'output');
            const outputProperties = output.properties as Record<string, unknown> | undefined;
            const rows = outputProperties?.rows as { type?: unknown; items?: { properties?: Record<string, unknown> } } | undefined;
            if (rows?.type !== 'array' || !rows.items?.properties) throw new Error(`Table query '${name}' must return a JSON Schema Page with rows[]`);
            if (!outputProperties?.nextCursor) throw new Error(`Table query '${name}' must return Page.nextCursor`);
            const inputProperties = getJsonSchema(operation.input, 'input').properties as Record<string, { type?: unknown; minimum?: unknown; maximum?: unknown }> | undefined;
            const limit = inputProperties?.limit;
            if (!limit || (limit.type !== 'integer' && limit.type !== 'number') || typeof limit.minimum !== 'number' || limit.minimum < 1 || typeof limit.maximum !== 'number' || limit.maximum < limit.minimum || limit.maximum > 200) throw new Error(`Table query '${name}' input must define a bounded numeric limit of at most 200`);
            if (inputProperties?.cursor?.type !== 'string') throw new Error(`Table query '${name}' input must define a string cursor`);
            rowProperties = rows.items.properties;
            if (!variant.rowKey || !rowProperties[variant.rowKey]) throw new Error(`Table variant '${variantName}' must declare a rowKey present in query '${name}' output`);
            for (const column of variant.columns ?? []) if (!rowProperties[column]) throw new Error(`Table column '${column}' is not present in query '${name}' output`);
          }
          for (const action of variant.actions ?? []) {
            if (!mutationNames.has(action.mutation)) throw new Error(`UI action references unknown mutation '${action.mutation}'`);
            const target = definition.mutations?.[action.mutation];
            if (action.variant && !target?.ui?.variants[action.variant]) throw new Error(`UI action references unknown variant '${action.variant}' on mutation '${action.mutation}'`);
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
function normalizePath(path: string) { return `/${path.split('/').filter(Boolean).join('/')}`; }
function randomId() { return globalThis.crypto.randomUUID(); }
function safeMessage(error: unknown) { return error instanceof WorkcoreError ? error.message.slice(0, 300) : 'Operation failed'; }
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
        await options.services.tasks.enqueue({ id: runId, applicationId: schedule.scope.applicationId, workspaceId: schedule.scope.workspaceId, operation: schedule.operation, input: schedule.input, codecId: codec.id, actorId: actor.id, correlationId: randomId(), createdAt: new Date().toISOString(), scheduleId: schedule.id });
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
