import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import type { DisplayDefinition, DisplaysDefinition, OperationUI } from './ui.js';
import { workcoreSchema } from './schema.js';
import { getTableName } from 'drizzle-orm';
import { builtinTriggers } from './triggers.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Actor = { id: string };
export type Tables = Record<string, SQLiteTable>;
export type Database<S extends Tables> = DrizzleSqliteDODatabase<S>;
export type FileBucket = {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
};
export type MigrationBundle = {
  journal: { entries: { idx: number; when: number; tag: string; breakpoints: boolean; version?: string }[] };
  migrations: Record<string, string>;
};
export type TableDisplay = { label?: string; columns?: Record<string, { label?: string; hidden?: boolean; format?: 'text' | 'badge' | 'date' }> };
export type ReadContext<S extends Tables> = { db: Database<S>; kv: { get(key: string): Json | null }; actor: Actor; now: number };
export type Operation<I extends z.ZodType = any, O extends z.ZodType = any, C = any> = {
  input: I;
  output: O;
  ui?: OperationUI;
  handler: (ctx: C, input: z.output<I>) => z.output<O>;
};
export type View<I extends z.ZodType = any, O extends z.ZodType = any, C = any, T extends string = string> = Operation<I, O, C> & {
  dependsOn?: readonly (T | '*')[];
  maxRows?: number;
};
export type Mutation<I extends z.ZodType = any, O extends z.ZodType = any, C = any, T extends string = string> = Operation<I, O, C> & {
  /** Omitted means wildcard. An empty list means dynamic triggers only. */
  triggers?: readonly (T | '*')[];
};
export type RunContext<S extends Tables, E> = {
  actor: Actor;
  env: E;
  runId: string;
  signal: AbortSignal;
  progress(value: Json): void;
  read<I extends z.ZodType, O extends z.ZodType>(operation: Operation<I, O>, input: z.input<I>): z.output<O>;
  mutate<I extends z.ZodType, O extends z.ZodType>(operation: Operation<I, O>, input: z.input<I>): z.output<O>;
  step<R extends Json>(label: string, execute: () => Promise<R>): Promise<R>;
};
export type Job<I extends z.ZodType = any, O extends z.ZodType = any, C = any> = {
  kind: 'task' | 'agent'; input: I; output: O; ui?: OperationUI;
  handler: (ctx: C, input: z.output<I>) => Promise<z.output<O>>;
  maxAttempts?: number; retryDelayMs?: number; maxSteps?: number; tools?: Operation[];
  /** Cooperative deadline per attempt. Aborts signal and expires tools; cannot stop arbitrary code. */
  timeoutMs?: number;
};
export type MutationContext<S extends Tables, T extends string = string> = {
  db: Database<S>; kv: ReadContext<S>['kv'] & { set(key: string, value: Json): void; delete(key: string): void }; actor: Actor; now: number;
  trigger(...keys: (T | '*')[]): void;
  enqueue<I extends z.ZodType>(job: Job<I>, input: z.input<I>): string;
  schedule<I extends z.ZodType>(job: Job<I>, input: z.input<I>, options: { at: number; everyMs?: number }): string;
  cancelSchedule(id: string): void;
};
export type Definition<S extends Tables = any, V extends Record<string, View> = Record<string, View>, Q extends Record<string, Operation> = Record<string, Operation>, M extends Record<string, Mutation> = Record<string, Mutation>, J extends Record<string, Job> = Record<string, Job>, T extends string = string, D extends Record<string, DisplayDefinition<any, ReadContext<S>>> = Record<string, DisplayDefinition<any, ReadContext<S>>>> = {
  tables: S;
  migrations: MigrationBundle;
  tableDisplay: Partial<Record<keyof S & string, TableDisplay>>;
  triggerKeys: readonly T[];
  views: V; queries: Q; mutations: M; jobs: J;
  authorize: (ctx: ReadContext<S>, action: string) => boolean;
  initialize?: (db: Database<S>) => void;
  displays?: DisplaysDefinition<ReadContext<S>, D>;
  files?: { table: string; bucket: (env: unknown) => FileBucket; maxSize: number };
};

/** Compose application tables with Workcore's private SQL schema for Drizzle Kit. */
export function defineSchema<const S extends Tables>(tables: S) {
  const internalNames = new Set<string>(Object.values(workcoreSchema).map(table => getTableName(table)));
  const applicationNames = new Set<string>();
  for (const [key, table] of Object.entries(tables)) {
    if (Object.hasOwn(workcoreSchema, key)) throw new Error(`Application schema key conflicts with Workcore table key: ${key}`);
    const name = getTableName(table);
    if (internalNames.has(name)) throw new Error(`Application table name conflicts with Workcore internal table: ${name}`);
    if (applicationNames.has(name)) throw new Error(`Application schema contains duplicate SQL table name: ${name}`);
    applicationNames.add(name);
  }
  return { ...workcoreSchema, ...tables } as typeof workcoreSchema & S;
}

/** Column builders are factories so each call creates fresh mutable Drizzle builders. */
export { idColumn, timestampColumns, versionColumn } from './schema-helpers.js';

/** Bind the schema types once; operations then infer the Drizzle database shape. */
export function workspace<S extends Tables, E = unknown, const K extends readonly string[] = readonly []>(tables: S, migrations: MigrationBundle, options: { tableDisplay?: Partial<Record<keyof S & string, TableDisplay>>; triggerKeys?: K } = {}) {
  type AppTrigger = K[number] | typeof builtinTriggers[keyof typeof builtinTriggers];
  return {
    view<I extends z.ZodType, O extends z.ZodType>(definition: View<I, O, ReadContext<S>, AppTrigger>) { return definition; },
    query<I extends z.ZodType, O extends z.ZodType>(definition: Operation<I, O, ReadContext<S>>) { return definition; },
    display<I extends z.ZodType>(definition: DisplayDefinition<I, ReadContext<S>>) { return definition; },
    mutation<I extends z.ZodType, O extends z.ZodType>(definition: Mutation<I, O, MutationContext<S, AppTrigger>, AppTrigger>) { return definition; },
    task<I extends z.ZodType, O extends z.ZodType>(definition: Omit<Job<I, O, RunContext<S, E>>, 'kind' | 'tools'>) { return { ...definition, kind: 'task' as const }; },
    agent<I extends z.ZodType, O extends z.ZodType>(definition: Omit<Job<I, O, RunContext<S, E>>, 'kind' | 'maxAttempts' | 'retryDelayMs'> & { tools: Operation[] }) { return { ...definition, kind: 'agent' as const, maxAttempts: 1 }; },
    define<V extends Record<string, View>, Q extends Record<string, Operation>, M extends Record<string, Mutation>, J extends Record<string, Job>, D extends Record<string, DisplayDefinition<any, ReadContext<S>>>>(
      definition: Omit<Definition<S, V, Q, M, J, AppTrigger, D>, 'tables' | 'migrations' | 'tableDisplay' | 'triggerKeys'>,
    ): Definition<S, V, Q, M, J, AppTrigger, D> { return { tables, migrations, tableDisplay: options.tableDisplay ?? {}, triggerKeys: options.triggerKeys ?? [] as unknown as readonly K[number][], ...definition }; },
  };
}
