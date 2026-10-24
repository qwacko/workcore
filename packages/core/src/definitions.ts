import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Actor = { id: string };
export type Table = {
  schema: z.ZodType;
  version: number;
  migrations: Record<number, (data: Json) => Json>;
  indexes: Record<string, string>;
};
export type Tables = Record<string, Table>;
export type Row<T> = { id: string; revision: number; schemaVersion: number; data: T };
export type Page<T> = { rows: Row<T>[]; nextCursor: string | null };
export type PageInput = { limit?: number; after?: string; index?: { name: string; value: string | number | boolean | null } };
export interface Reader<T extends Tables> {
  get<K extends keyof T & string>(table: K, id: string): Row<z.output<T[K]['schema']>> | null;
  page<K extends keyof T & string>(table: K, input?: PageInput): Page<z.output<T[K]['schema']>>;
  all<K extends keyof T & string>(table: K): Row<z.output<T[K]['schema']>>[];
  kv: { get(key: string): Json | null };
}
export interface Writer<T extends Tables> extends Reader<T> {
  put<K extends keyof T & string>(table: K, id: string, data: z.input<T[K]['schema']>, options?: { expectedRevision?: number }): Row<z.output<T[K]['schema']>>;
  delete<K extends keyof T & string>(table: K, id: string, options?: { expectedRevision?: number }): void;
  kv: Reader<T>['kv'] & { set(key: string, value: Json): void; delete(key: string): void };
}
export type ReadContext<T extends Tables> = { db: Reader<T>; actor: Actor; now: number };
export type Operation<I extends z.ZodType = any, O extends z.ZodType = any, C = any> = {
  input: I;
  output: O;
  handler: (ctx: C, input: z.output<I>) => z.output<O>;
};
export type View<I extends z.ZodType = any, O extends z.ZodType = any, C = any> = Operation<I, O, C> & {
  dependsOn: string[];
  maxRows?: number;
};
export type RunContext<T extends Tables, E> = {
  actor: Actor;
  env: E;
  runId: string;
  read<I extends z.ZodType, O extends z.ZodType>(operation: Operation<I, O>, input: z.input<I>): z.output<O>;
  mutate<I extends z.ZodType, O extends z.ZodType>(operation: Operation<I, O>, input: z.input<I>): z.output<O>;
  step<R extends Json>(label: string, execute: () => Promise<R>): Promise<R>;
};
export type Job<I extends z.ZodType = any, O extends z.ZodType = any, C = any> = {
  kind: 'task' | 'agent';
  input: I;
  output: O;
  handler: (ctx: C, input: z.output<I>) => Promise<z.output<O>>;
  maxAttempts?: number;
  retryDelayMs?: number;
  maxSteps?: number;
  tools?: Operation[];
};
export type MutationContext<T extends Tables> = {
  db: Writer<T>;
  actor: Actor;
  now: number;
  enqueue<I extends z.ZodType>(job: Job<I>, input: z.input<I>): string;
  schedule<I extends z.ZodType>(job: Job<I>, input: z.input<I>, options: { at: number; everyMs?: number }): string;
  cancelSchedule(id: string): void;
};
export type Definition<T extends Tables = Tables, V extends Record<string, View> = Record<string, View>, Q extends Record<string, Operation> = Record<string, Operation>, M extends Record<string, Operation> = Record<string, Operation>, J extends Record<string, Job> = Record<string, Job>> = {
  tables: T;
  views: V;
  queries: Q;
  mutations: M;
  jobs: J;
  authorize: (ctx: ReadContext<T>, action: string) => boolean;
  initialize?: (db: Writer<T>) => void;
};

/** The map key in migrations is the version being migrated TO. */
export function table<S extends z.ZodType>(schema: S, options: Partial<Omit<Table, 'schema'>> = {}): Table & { schema: S } {
  return { schema, version: 1, migrations: {}, indexes: {}, ...options };
}

/** Bind table types once; operation helpers then infer inputs, outputs and database calls. */
export function workspace<T extends Tables, E = unknown>(tables: T) {
  return {
    view<I extends z.ZodType, O extends z.ZodType>(definition: View<I, O, ReadContext<T>>) { return definition; },
    query<I extends z.ZodType, O extends z.ZodType>(definition: Operation<I, O, ReadContext<T>>) { return definition; },
    mutation<I extends z.ZodType, O extends z.ZodType>(definition: Operation<I, O, MutationContext<T>>) { return definition; },
    task<I extends z.ZodType, O extends z.ZodType>(definition: Omit<Job<I, O, RunContext<T, E>>, 'kind' | 'tools'>) {
      return { ...definition, kind: 'task' as const };
    },
    agent<I extends z.ZodType, O extends z.ZodType>(definition: Omit<Job<I, O, RunContext<T, E>>, 'kind' | 'maxAttempts' | 'retryDelayMs'> & { tools: Operation[] }) {
      return { ...definition, kind: 'agent' as const, maxAttempts: 1 };
    },
    define<V extends Record<string, View>, Q extends Record<string, Operation>, M extends Record<string, Operation>, J extends Record<string, Job>>(
      definition: Omit<Definition<T, V, Q, M, J>, 'tables'>,
    ): Definition<T, V, Q, M, J> { return { tables, ...definition }; },
  };
}
