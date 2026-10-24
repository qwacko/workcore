import {
  defineWorkspace,
  type Actor, type AdminBlock, type AdminConfiguration, type AdminPage, type AgentCallContext, type AgentDefinition, type AnySchema,
  type ExecutionContext, type InputFor, type InputOf, type OperationCallContext, type OperationCaller,
  type OperationKind, type OperationViews, type OperationViewsFor, type OutputFor, type OutputOf,
  type Permission, type PublicOperationNames, type RuntimeAgent, type RuntimeDefinition, type RuntimeOperation,
  type Scope, type SemanticAdminContext, type WorkcoreEvent, type WorkspaceDefinition,
} from './index.js';

const moduleBrand = Symbol('WorkcoreModule');
type Input<S> = S extends AnySchema ? InputOf<S> : never;
type Output<S> = S extends AnySchema ? OutputOf<S> : never;
type RequiredKeys<D> = { [K in keyof D]-?: {} extends Pick<D, K> ? never : K }[keyof D];
type Requirements<D> = { [K in RequiredKeys<D> & string]: true };
type RequirementOption<D> = [RequiredKeys<D>] extends [never] ? { requires?: Requirements<D> } : { requires: Requirements<D> };

type LocalCaller<Q extends object, QO extends Record<keyof Q, AnySchema>, M extends object, MO extends Record<keyof M, AnySchema>, T extends object, A extends object> = {
  query<N extends keyof Q & string>(name: N, input: Input<Q[N]>): Promise<OutputOf<QO[N]>>;
  mutate<N extends keyof M & string>(name: N, input: Input<M[N]>): Promise<OutputOf<MO[N]>>;
  enqueue<N extends keyof T & string>(name: N, input: Input<T[N]>): Promise<{ runId: string }>;
  enqueueAgent<N extends keyof A & string>(name: N, input: Input<A[N]>, options?: { conversationId?: string }): Promise<{ runId: string }>;
};
type ModuleOperations<App, Dependencies, Inputs extends object, Outputs extends Record<keyof Inputs, AnySchema>, Tools, Kind extends OperationKind, Mutations extends object> = {
  [K in keyof Inputs]: {
    input: Inputs[K]; output: Outputs[K]; version?: number; api?: boolean;
    permission?: Permission<App, Output<NoInfer<Inputs[K]>>>;
    views?: OperationViewsFor<Mutations>;
    handler: (args: OperationCallContext<App, Output<NoInfer<Inputs[K]>>, Tools> & { dependencies: Dependencies }) => InputOf<NoInfer<Outputs[K]>> | Promise<InputOf<NoInfer<Outputs[K]>>>;
    readonly kind?: Kind;
  } & (Kind extends 'task' ? { triggers?: { mutations?: readonly (keyof Mutations & string)[]; mapInput?: (event: Omit<WorkcoreEvent, 'operation' | 'type'> & { type: 'mutation.succeeded'; operation: keyof Mutations & string }) => Input<NoInfer<Inputs[K]>> } } : {});
} & { [K in keyof Outputs]: { output: Outputs[K] } };

type ModuleAgents<App, Dependencies, A extends object, Q extends object, M extends object, T extends object, Tools> = {
  [K in keyof A]: Omit<AgentDefinition<App, A[K] extends AnySchema ? A[K] : AnySchema>, 'tools' | 'finishWhen' | 'instructions' | 'prompt'> & {
    tools: readonly (
      | { kind: 'query'; operation: keyof Q & string; description?: string }
      | { kind: 'mutation'; operation: keyof M & string; description?: string }
      | { kind: 'task'; operation: keyof T & string; description?: string }
    )[];
    finishWhen: { tool: `query.${keyof Q & string}` | `mutation.${keyof M & string}` | `task.${keyof T & string}` };
    instructions: string | ((args: Omit<AgentCallContext<App, Output<NoInfer<A[K]>>>, 'operations'> & { dependencies: Dependencies; operations: Tools }) => string | Promise<string>);
    prompt: (args: Omit<AgentCallContext<App, Output<NoInfer<A[K]>>>, 'operations'> & { dependencies: Dependencies; operations: Tools }) => string | Promise<string>;
  };
};
type ModuleBlock<Q extends object, M extends object, T extends object> =
  | (Extract<AdminBlock, { type: 'query' }> & { operation: keyof Q & string })
  | (Extract<AdminBlock, { type: 'mutation-form' }> & { operation: keyof M & string })
  | (Extract<AdminBlock, { type: 'task-launcher' }> & { operation: keyof T & string })
  | Exclude<AdminBlock, { type: 'query' | 'mutation-form' | 'task-launcher' }>;
type ModulePages<Q extends object, M extends object, T extends object> = { pages?: Record<string, Omit<AdminPage, 'blocks'> & { blocks: readonly ModuleBlock<Q, M, T>[] }> };
type ModuleAdmin<Q extends object, M extends object, T extends object> = ModulePages<Q, M, T>
  | ((context: SemanticAdminContext<Q, M, T>) => ModulePages<Q, M, T>);

/** Module dependencies are execution-bound capabilities, not process-wide actor/context singletons. */
export type ModuleDefinition<App, Dependencies, Catalog> = Catalog & {
  readonly [moduleBrand]: true;
  readonly __moduleContext?: App;
  readonly __moduleDependencies?: Dependencies;
};

/** Define an independently validated local catalog. Mount it with composeApplication, not registerApplication. */
export function defineModule<App, Dependencies extends object = {}>() {
  return <
    const Id extends string,
    const Q extends object = {}, QO extends Record<keyof Q, AnySchema> = { [K in keyof Q]: never },
    const M extends object = {}, MO extends Record<keyof M, AnySchema> = { [K in keyof M]: never },
    const T extends object = {}, TO extends Record<keyof T, AnySchema> = { [K in keyof T]: never },
    const A extends object = {},
    const Authored extends { queries?: object; mutations?: object; tasks?: object } = {},
  >(options: {
    id: Id;
    queries?: ModuleOperations<App, Dependencies, Q, QO, LocalCaller<NoInfer<Q>, NoInfer<QO>, NoInfer<M>, NoInfer<MO>, NoInfer<T>, NoInfer<A>>, 'query', NoInfer<M>>;
    mutations?: ModuleOperations<App, Dependencies, M, MO, LocalCaller<NoInfer<Q>, NoInfer<QO>, NoInfer<M>, NoInfer<MO>, NoInfer<T>, NoInfer<A>>, 'mutation', NoInfer<M>>;
    tasks?: ModuleOperations<App, Dependencies, T, TO, LocalCaller<NoInfer<Q>, NoInfer<QO>, NoInfer<M>, NoInfer<MO>, NoInfer<T>, NoInfer<A>>, 'task', NoInfer<M>>;
    agents?: ModuleAgents<App, Dependencies, A, Q, M, T, LocalCaller<NoInfer<Q>, NoInfer<QO>, NoInfer<M>, NoInfer<MO>, NoInfer<T>, NoInfer<A>>>;
    admin?: ModuleAdmin<Q, M, T>;
    authorization?: never;
  } & RequirementOption<Dependencies> & Authored): ModuleDefinition<App, Dependencies, {
    id: Id;
    requires: Requirements<Dependencies>;
    queries: ModuleOperations<App, Dependencies, Q, QO, LocalCaller<Q, QO, M, MO, T, A>, 'query', M>;
    mutations: ModuleOperations<App, Dependencies, M, MO, LocalCaller<Q, QO, M, MO, T, A>, 'mutation', M>;
    tasks: ModuleOperations<App, Dependencies, T, TO, LocalCaller<Q, QO, M, MO, T, A>, 'task', M>;
    agents: ModuleAgents<App, Dependencies, A, Q, M, T, LocalCaller<Q, QO, M, MO, T, A>>;
    admin?: AdminConfiguration;
    readonly __publicOperations?: { [K in OperationKind]: PublicOperationNames<Authored, K> };
  }> => {
    if (options.authorization !== undefined) throw new Error('Module authorization belongs on the composed application');
    if (options.requires !== undefined && (!options.requires || typeof options.requires !== 'object' || Array.isArray(options.requires))) throw new Error('Module requires must be a dependency-name map');
    for (const [name, required] of Object.entries(options.requires ?? {})) {
      assertLocalName(name, 'dependency');
      if (required !== true) throw new Error(`Required dependency '${name}' must be declared as true`);
    }
    for (const field of ['queries', 'mutations', 'tasks', 'agents'] as const) for (const name of Object.keys(options[field] ?? {})) assertLocalName(name, field);
    const definition = defineWorkspace<App>()(options as never);
    if (definition.admin?.builtins || definition.admin?.defaultPage !== undefined) throw new Error('Module admin may contribute pages only; builtins/defaultPage belong on the application');
    // registerApplication is non-enumerable: modules intentionally have no standalone host registration.
    return Object.freeze({ ...definition, requires: { ...options.requires }, [moduleBrand]: true }) as never;
  };
}

type AnyModule = { readonly [moduleBrand]: true; id: string; requires: object; queries: object; mutations: object; tasks: object; agents: object; admin?: AdminConfiguration; readonly __moduleContext?: unknown; readonly __moduleDependencies?: unknown };
type Modules = Record<string, AnyModule>;
type DependenciesOf<M> = M extends { readonly __moduleDependencies?: infer D } ? NonNullable<D> : never;
type ContextOf<M> = M extends { readonly __moduleContext?: infer C } ? C : never;
type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
type Prefixed<T, P extends string> = T extends string ? `${P}.${T}` : T;
type QualifyFields<T, P extends string, Fields extends string> = T extends object ? { [K in keyof T]: K extends Fields ? Prefixed<T[K], P> : T[K] } : T;
type QualifyReferences<T, P extends string> = T extends object ? { [K in keyof T]: QualifyFields<T[K], P, 'mutation'> } : T;
type QualifyCollection<T, P extends string> = T extends object ? { [K in keyof T]: K extends 'editor' ? QualifyFields<T[K], P, 'mutation'> : K extends 'actions' ? QualifyReferences<T[K], P> : T[K] } : T;
type QualifyChat<T, P extends string> = T extends object ? { [K in keyof T]: K extends 'sendMutation' ? Prefixed<T[K], P> : K extends 'actions' ? QualifyReferences<T[K], P> : T[K] } : T;
type QualifyVariant<T, P extends string> = T extends object ? { [K in keyof T]:
  K extends 'actions' | 'chatActions' ? QualifyReferences<T[K], P>
    : K extends 'collection' ? QualifyCollection<T[K], P>
      : K extends 'chat' ? QualifyChat<T[K], P>
        : K extends 'chatList' ? QualifyFields<T[K], P, 'threadQuery'> : T[K]
} : T;
type QualifyVariants<T, P extends string> = T extends object ? { [K in keyof T]: QualifyVariant<T[K], P> } : T;
type QualifyViews<T, P extends string> = T extends object ? { [K in keyof T]: K extends 'variants' ? QualifyVariants<T[K], P> : T[K] } : T;
// Public presentation references must describe the compiled catalog, not the module's local names.
type QualifyOperation<T, P extends string> = { [K in keyof T]: K extends 'views' ? QualifyViews<T[K], P> : T[K] };
type Flatten<M extends Modules, Field extends 'queries' | 'mutations' | 'tasks' | 'agents'> = [keyof M] extends [never] ? {} : UnionToIntersection<{
  [P in keyof M & string]: { [N in keyof M[P][Field] & string as `${P}.${N}`]: QualifyOperation<M[P][Field][N], P> }
}[keyof M & string]> & {};
type Catalog<M extends Modules> = { queries: Flatten<M, 'queries'>; mutations: Flatten<M, 'mutations'>; tasks: Flatten<M, 'tasks'>; agents: Flatten<M, 'agents'> };
type MapFor<M extends Modules, K extends OperationKind> = K extends 'query' ? Catalog<M>['queries'] : K extends 'mutation' ? Catalog<M>['mutations'] : Catalog<M>['tasks'];
export type ComposedOperationCaller<M extends Modules> = {
  query<N extends keyof MapFor<M, 'query'> & string>(name: N, input: InputFor<MapFor<M, 'query'>[N]>): Promise<OutputFor<MapFor<M, 'query'>[N]>>;
  mutate<N extends keyof MapFor<M, 'mutation'> & string>(name: N, input: InputFor<MapFor<M, 'mutation'>[N]>): Promise<OutputFor<MapFor<M, 'mutation'>[N]>>;
  enqueue<N extends keyof MapFor<M, 'task'> & string>(name: N, input: InputFor<MapFor<M, 'task'>[N]>): Promise<{ runId: string }>;
  enqueueAgent<N extends keyof Catalog<M>['agents'] & string>(name: N, input: Catalog<M>['agents'][N] extends { input: infer S } ? Input<S> : never, options?: { conversationId?: string }): Promise<{ runId: string }>;
};
type RequiredModules<M extends Modules> = { [K in keyof M]: [RequiredKeys<DependenciesOf<M[K]>>] extends [never] ? never : K }[keyof M];
type Binding<App, M extends Modules, N extends keyof M> = (args: { ctx: ExecutionContext<App>; operations: ComposedOperationCaller<M> }) => DependenciesOf<M[N]> | Promise<DependenciesOf<M[N]>>;
type Bindings<App, M extends Modules> = { [K in RequiredModules<M>]: Binding<App, M, K> } & { [K in Exclude<keyof M, RequiredModules<M>>]?: Binding<App, M, K> };
type BindingOption<App, M extends Modules> = [RequiredModules<M>] extends [never] ? { dependencies?: Bindings<App, M> } : { dependencies: Bindings<App, M> };
type Schemas<O> = { [K in keyof O]: O[K] extends { input: infer S } ? S : never };
type PublicCatalog<M extends Modules> = { [K in OperationKind]: { [P in keyof M & string]: `${P}.${PublicOperationNames<M[P], K>}` }[keyof M & string] };
type Authorization<S extends AnySchema | undefined> = S extends AnySchema ? { context: S; check: (args: { auth: OutputOf<NoInfer<S>>; actor: Actor; scope: Scope; permission: string; input: unknown }) => boolean | Promise<boolean> } : undefined;
type ComposedDefinition<App, Id extends string, M extends Modules, S extends AnySchema | undefined> = WorkspaceDefinition<App,
  Catalog<M> & { id: Id; admin?: AdminConfiguration; readonly __publicOperations?: PublicCatalog<M> }
  & ([S] extends [undefined] ? { authorization?: undefined } : { authorization: Authorization<S> })>;

/** Compose local modules into one ordinary checked application; no new transport, queue, or event bus. */
export function composeApplication<App>() {
  return <const Id extends string, const M extends Modules, const S extends AnySchema | undefined = undefined>(options: {
    id: Id;
    modules: M & { [K in keyof M]: App extends ContextOf<M[K]> ? M[K] : never };
    authorization?: Authorization<S>;
    admin?: AdminConfiguration | ((context: SemanticAdminContext<Schemas<Catalog<M>['queries']>, Schemas<Catalog<M>['mutations']>, Schemas<Catalog<M>['tasks']>>) => AdminConfiguration);
  } & BindingOption<App, NoInfer<M>>): ComposedDefinition<App, Id, M, S> => {
    if (!options.modules || typeof options.modules !== 'object' || Array.isArray(options.modules)) throw new Error('Composed modules must be a namespace-to-module map');
    if (options.dependencies !== undefined && (!options.dependencies || typeof options.dependencies !== 'object' || Array.isArray(options.dependencies))) throw new Error('Composed dependencies must be a module-to-factory map');
    const definition: RuntimeDefinition = { id: options.id, queries: {}, mutations: {}, tasks: {}, agents: {} };
    const pages: NonNullable<AdminConfiguration['pages']> = {};
    const bindings = (options.dependencies ?? {}) as Record<string, ((args: { ctx: ExecutionContext<unknown>; operations: OperationCaller }) => object | Promise<object>) | undefined>;
    for (const name of Object.keys(bindings)) if (!Object.hasOwn(options.modules, name)) throw new Error(`Dependency binding references unknown module '${name}'`);
    for (const [namespace, raw] of Object.entries(options.modules)) {
      assertLocalName(namespace, 'module');
      if (!raw || typeof raw !== 'object' || raw[moduleBrand] !== true) throw new Error(`Module '${namespace}' must be created with defineModule`);
      const module = raw as unknown as RuntimeDefinition & { requires: Record<string, true> };
      const binding = bindings[namespace];
      if (binding !== undefined && typeof binding !== 'function') throw new Error(`Dependency binding for '${namespace}' must be a function`);
      if (Object.keys(module.requires).length && !binding) throw new Error(`Missing dependency binding for module '${namespace}'`);
      const argsFor = async (args: { ctx: ExecutionContext<unknown>; operations: OperationCaller; input: unknown }) => {
        const ctx = moduleContext(args.ctx, namespace);
        const dependencies = binding ? await binding({ ctx, operations: args.operations }) : {};
        if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw new Error(`Dependencies for '${namespace}' must resolve to an object`);
        for (const key of Object.keys(module.requires)) if (!Object.hasOwn(dependencies, key) || (dependencies as Record<string, unknown>)[key] === undefined) throw new Error(`Missing required dependency '${namespace}.${key}'`);
        return { ...args, ctx, dependencies, operations: localCaller(args.operations, namespace) };
      };
      for (const [kind, field] of [['query', 'queries'], ['mutation', 'mutations'], ['task', 'tasks']] as const) {
        for (const [name, operation] of Object.entries(module[field] ?? {})) {
          const qualified = `${namespace}.${name}`;
          const triggers = field === 'tasks' ? module.tasks?.[name]?.triggers : undefined;
          const wrapped = {
            ...operation, kind,
            ...(operation.views ? { views: namespaceViews(operation.views, namespace) } : {}),
            ...(triggers ? { triggers: {
              ...(triggers.mutations ? { mutations: triggers.mutations.map((mutation) => `${namespace}.${mutation}`) } : {}),
              ...(triggers.mapInput ? { mapInput: (event: WorkcoreEvent) => triggers.mapInput!({ ...event, ...(event.operation ? { operation: event.operation.slice(namespace.length + 1) } : {}) }) } : {}),
            } } : {}),
            handler: async (args: OperationCallContext<unknown, unknown>) => operation.handler(await argsFor(args)),
          };
          (definition[field] as Record<string, RuntimeOperation>)[qualified] = wrapped;
        }
      }
      for (const [name, agent] of Object.entries(module.agents ?? {})) {
        const dot = agent.finishWhen.tool.indexOf('.');
        definition.agents![`${namespace}.${name}`] = {
          ...agent,
          tools: agent.tools.map((tool) => ({ ...tool, operation: `${namespace}.${tool.operation}` })),
          finishWhen: { tool: `${agent.finishWhen.tool.slice(0, dot)}.${namespace}.${agent.finishWhen.tool.slice(dot + 1)}` },
          instructions: typeof agent.instructions === 'function' ? async (args) => (agent.instructions as Exclude<RuntimeAgent['instructions'], string>)(await argsFor(args)) : agent.instructions,
          prompt: async (args) => agent.prompt(await argsFor(args)),
        };
      }
      for (const [name, page] of Object.entries(module.admin?.pages ?? {})) pages[`${namespace}.${name}`] = {
        ...page,
        blocks: page.blocks.map((block) => 'operation' in block ? { ...block, operation: `${namespace}.${block.operation}` } : block),
      };
    }
    const admin = options.admin;
    const combined = {
      ...definition,
      ...(options.authorization ? { authorization: options.authorization } : {}),
      admin: (context: unknown) => {
        const authored = (typeof admin === 'function' ? admin(context as never) : admin) ?? {};
        for (const name of Object.keys(authored.pages ?? {})) if (Object.hasOwn(pages, name)) throw new Error(`Duplicate composed admin page '${name}'`);
        return { ...authored, pages: { ...pages, ...authored.pages } };
      },
    };
    return defineWorkspace<App>()(combined as never) as unknown as ComposedDefinition<App, Id, M, S>;
  };
}

function assertLocalName(name: string, kind: string) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) || ['constructor', 'prototype', '__proto__'].includes(name)) throw new Error(`Invalid local ${kind} name '${name}'`);
}

function localCaller(caller: OperationCaller, namespace: string): OperationCaller {
  return {
    query: (name, input) => caller.query(`${namespace}.${name}`, input),
    mutate: (name, input) => caller.mutate(`${namespace}.${name}`, input),
    enqueue: (name, input) => caller.enqueue(`${namespace}.${name}`, input),
    enqueueAgent: (name, input, options) => caller.enqueueAgent(`${namespace}.${name}`, input, options),
  };
}

function moduleContext(ctx: ExecutionContext<unknown>, namespace: string): ExecutionContext<unknown> {
  const key = (value: string) => `@workcore/module/${JSON.stringify([namespace, value])}`;
  const log = (level: 'debug' | 'info' | 'warn' | 'error') => (message: string, fields?: Record<string, unknown>) => ctx.services.logger[level](message, { ...fields, module: namespace });
  const logger = { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
  return { ...ctx, services: { ...ctx.services, logger, kv: {
    get: <T>(name: string) => ctx.services.kv.get<T>(key(name)),
    set: (name, value) => ctx.services.kv.set(key(name), value),
    delete: (name) => ctx.services.kv.delete(key(name)),
  } } };
}

function namespaceViews(views: OperationViews, namespace: string): OperationViews {
  const mutation = <T extends { mutation: string }>(value: T): T => ({ ...value, mutation: `${namespace}.${value.mutation}` });
  return { ...views, variants: Object.fromEntries(Object.entries(views.variants).map(([name, view]) => [name, {
    ...view,
    ...(view.actions ? { actions: view.actions.map(mutation) } : {}),
    ...(view.collection ? { collection: { ...view.collection,
      ...(view.collection.editor ? { editor: mutation(view.collection.editor) } : {}),
      ...(view.collection.actions ? { actions: view.collection.actions.map(mutation) } : {}),
    } } : {}),
    ...(view.chat ? { chat: { ...view.chat,
      ...(view.chat.sendMutation ? { sendMutation: `${namespace}.${view.chat.sendMutation}` } : {}),
      ...(view.chat.actions ? { actions: Object.fromEntries(Object.entries(view.chat.actions).map(([key, value]) => [key, mutation(value)])) } : {}),
    } } : {}),
    ...(view.chatActions ? { chatActions: Object.fromEntries(Object.entries(view.chatActions).map(([key, value]) => [key, mutation(value)])) } : {}),
    ...(view.chatList?.threadQuery ? { chatList: { ...view.chatList, threadQuery: `${namespace}.${view.chatList.threadQuery}` } } : {}),
  }])) };
}
