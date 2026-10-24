import { composeApplication, defineModule } from '@workcore/core';
import { createClient, createFetchTransport } from '@workcore/client';
import { z } from 'zod';
import { calendarModule, composedApplication, settingsModule, todosModule } from './composed.js';

// This file is compiled, not executed. Runtime cases live in composed.test.ts.
type Context = Parameters<Parameters<typeof composedApplication.registerApplication>[0]['createAppContext']>[0];
void (undefined as unknown as Context);
type App = Awaited<ReturnType<Parameters<typeof composedApplication.registerApplication>[0]['createAppContext']>>;

function verifyClientBoundary() {
  const client = createClient<typeof composedApplication>({ transport: createFetchTransport(), applicationId: 'composed', workspaceId: 'one' });
  void client.query('todos.list', {}).then((rows) => { const title: string | undefined = rows[0]?.title; void title; });
  void client.mutate('todos.create', { title: 'Typed' });
  // @ts-expect-error Local names are not public names in a composed application.
  void client.query('list', {});
  // @ts-expect-error An internal target remains internal even when dependencies can call it.
  void client.mutate('calendar.record', { title: 'Hidden' });
  // @ts-expect-error Required operation inputs are retained through composition.
  void client.mutate('todos.create', {});
  // @ts-expect-error Module prefixes are checked too.
  void client.query('missing.list', {});
}
void verifyClientBoundary;

// @ts-expect-error The todos module has a required dependency binding.
composeApplication<App>()({ id: 'missing-binding', modules: { todos: todosModule } });

composeApplication<App>()({ id: 'bad-return', modules: { todos: todosModule }, dependencies: {
  // @ts-expect-error A required dependency must return its declared output type.
  todos: () => ({ getTimezone: async () => 42 }),
} });

composeApplication<App>()({ id: 'missing-required-function', modules: { todos: todosModule }, dependencies: {
  // @ts-expect-error Optional callbacks do not replace required dependencies.
  todos: () => ({ afterCompleted: async () => {} }),
} });

composeApplication<App>()({ id: 'bad-wiring', modules: { todos: todosModule, calendar: calendarModule, settings: settingsModule }, dependencies: {
  todos: ({ operations }) => ({ getTimezone: () => operations.query('settings.timezone', {}), afterCompleted: async (todo) => {
    // @ts-expect-error Cross-module operation names are inferred.
    await operations.mutate('calendar.missing', {});
    // @ts-expect-error Target operation inputs are inferred.
    await operations.mutate('calendar.record', { title: 42 });
    // @ts-expect-error Callback input comes from TodoDependencies.
    const invalid: number = todo.title;
    void invalid;
  } }),
} });

composeApplication<{}>()({ id: 'wrong-context', modules: {
  // @ts-expect-error The host context must satisfy the module's repository requirements.
  calendar: calendarModule,
} });

// @ts-expect-error Required dependencies must be listed for runtime composition validation.
defineModule<{}, { required: () => Promise<string> }>()({ id: 'missing-requires' });

const local = defineModule<{}>()({ id: 'local', queries: {
  value: { input: z.object({}), output: z.string().transform(Number).pipe(z.number()), api: true, permission: [], handler: () => '42' },
  sibling: { input: z.object({}), output: z.number(), permission: [], handler: async ({ operations }) => {
    const value: number = await operations.query('value', {});
    // @ts-expect-error Local callers do not accept fully qualified or unrelated operation names.
    await operations.query('local.value', {});
    return value;
  } },
} });
const transformed = composeApplication<{}>()({ id: 'transformed-module', modules: { first: local, second: local } });
function verifyTransformedClient() {
  const client = createClient<typeof transformed>({ transport: createFetchTransport(), applicationId: transformed.id, workspaceId: 'one' });
  void client.query('first.value', {}).then((result) => {
    const value: number = result;
    // @ts-expect-error Transformed caller outputs are retained.
    const raw: string = result;
    void value; void raw;
  });
}
void verifyTransformedClient;

const authSchema = z.object({ owner: z.boolean() });
const authorized = composeApplication<{}>()({ id: 'authorized-module', modules: { local }, authorization: {
  context: authSchema,
  check: ({ auth }) => {
    const allowed: boolean = auth.owner;
    // @ts-expect-error The authorization schema should contextually type the checker.
    auth.missing;
    return allowed;
  },
} });
authorized.registerApplication({ createAppContext: () => ({}), resolveAuthorization: () => ({ owner: true }) });
// @ts-expect-error Composed authorization still requires its trusted resolver.
authorized.registerApplication({ createAppContext: () => ({}) });
