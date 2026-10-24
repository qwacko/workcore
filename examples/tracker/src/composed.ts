import { composeApplication, createMemoryState, createPlatform, defineModule, type Scope } from '@workcore/core';
import { createClient, createFetchTransport } from '@workcore/client';
import { z } from 'zod';

const todoSchema = z.object({ id: z.string(), title: z.string(), completed: z.boolean() });
type Todo = z.output<typeof todoSchema>;
type TodoContext = { todos: {
  list(scope: Scope): Todo[];
  create(scope: Scope, title: string): Todo;
  complete(scope: Scope, id: string): Todo;
} };
type CalendarContext = { calendar: {
  record(scope: Scope, title: string): void;
  list(scope: Scope): string[];
} };
type AppContext = TodoContext & CalendarContext & { timezone: string };
type TodoDependencies = {
  getTimezone: () => Promise<string>;
  afterCompleted?: (todo: Todo) => Promise<void>;
};

export const todosModule = defineModule<TodoContext, TodoDependencies>()({
  id: 'todos',
  requires: { getTimezone: true },
  queries: {
    list: { input: z.object({}), output: z.array(todoSchema), api: true, permission: [], handler: ({ ctx }) => ctx.app.todos.list(ctx.scope) },
    timezone: { input: z.object({}), output: z.string(), api: true, permission: [], handler: ({ dependencies }) => dependencies.getTimezone() },
  },
  mutations: {
    create: {
      input: z.object({ title: z.string().min(1) }), output: todoSchema, api: true, permission: [],
      handler: ({ ctx, input }) => ctx.app.todos.create(ctx.scope, input.title),
    },
    complete: {
      input: z.object({ id: z.string() }), output: todoSchema, api: true, permission: [],
      handler: async ({ ctx, input, dependencies }) => {
        const todo = ctx.app.todos.complete(ctx.scope, input.id);
        // Awaited after the write. Failure propagates, but does not roll back the todo.
        await dependencies.afterCompleted?.(todo);
        return todo;
      },
    },
  },
  admin: ({ queries }) => ({ pages: { overview: { title: 'Todos', blocks: [queries.list.view('json', { id: 'list', input: {} })] } } }),
});

export const calendarModule = defineModule<CalendarContext>()({
  id: 'calendar',
  queries: { entries: { input: z.object({}), output: z.array(z.string()), api: true, permission: [], handler: ({ ctx }) => ctx.app.calendar.list(ctx.scope) } },
  mutations: { record: {
    input: z.object({ title: z.string() }), output: z.object({ ok: z.literal(true) }),
    // Internal operation: composition can call it, but the HTTP client cannot.
    permission: 'calendar.write',
    handler: ({ ctx, input }) => { ctx.app.calendar.record(ctx.scope, input.title); return { ok: true as const }; },
  } },
});

export const settingsModule = defineModule<{ timezone: string }>()({
  id: 'settings',
  queries: { timezone: { input: z.object({}), output: z.string(), permission: [], handler: ({ ctx }) => ctx.app.timezone } },
});

export const composedApplication = composeApplication<AppContext>()({
  id: 'composed',
  modules: { todos: todosModule, calendar: calendarModule, settings: settingsModule },
  dependencies: {
    todos: ({ operations }) => ({
      getTimezone: () => operations.query('settings.timezone', {}),
      afterCompleted: async (todo) => { await operations.mutate('calendar.record', { title: todo.title }); },
    }),
  },
  admin: { defaultPage: 'todos.overview' },
});

/** Single-process, executable composition example; repositories still own scoped domain data. */
export function createComposedExample(options: { calendarWrites?: boolean } = {}) {
  const todoRows = new Map<string, Todo[]>();
  const calendarRows = new Map<string, string[]>();
  const key = (scope: Scope) => JSON.stringify([scope.applicationId, scope.workspaceId]);
  const context: AppContext = {
    timezone: 'UTC',
    todos: {
      list: (scope) => todoRows.get(key(scope)) ?? [],
      create: (scope, title) => {
        const todo = { id: crypto.randomUUID(), title, completed: false };
        todoRows.set(key(scope), [...context.todos.list(scope), todo]);
        return todo;
      },
      complete: (scope, id) => {
        const todo = context.todos.list(scope).find((item) => item.id === id);
        if (!todo) throw new Error('Todo not found');
        todo.completed = true;
        return todo;
      },
    },
    calendar: {
      record: (scope, title) => { calendarRows.set(key(scope), [...context.calendar.list(scope), title]); },
      list: (scope) => calendarRows.get(key(scope)) ?? [],
    },
  };
  const services = createMemoryState({ workspaces: [
    { applicationId: composedApplication.id, id: 'one', name: 'One', actors: ['demo'] },
    { applicationId: composedApplication.id, id: 'two', name: 'Two', actors: ['demo'] },
  ] });
  const platform = createPlatform({
    applications: [composedApplication.registerApplication({ createAppContext: () => context })],
    auth: { authenticate: () => ({ id: 'demo' }), resolveActor: () => ({ id: 'demo' }) },
    authorise: ({ permission }) => permission === 'calendar.write' && options.calendarWrites !== false,
    services,
  });
  const handle = platform.httpHandler();
  const transport = createFetchTransport({ baseUrl: 'http://localhost/workcore/api', fetch: (url, init) => handle(new Request(url, init)) });
  const client = (workspaceId: string) => createClient<typeof composedApplication>({ transport, applicationId: composedApplication.id, workspaceId });
  return { platform, services, handle, transport, client, context };
}
