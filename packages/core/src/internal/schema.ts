import type { AnySchema, CompiledOperationPresentation, JsonSchema, JsonSchemaProvider, RuntimeDefinition, RuntimeOperation, OperationKind, ValidationIssue } from '../index.js';
import { WorkcoreError } from './errors.js';

export async function validate(schema: AnySchema, value: unknown): Promise<unknown> {
  const result = await schema['~standard'].validate(value) as { value?: unknown; issues?: readonly { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] }[] };
  if (result.issues) {
    const issues: ValidationIssue[] = result.issues.map((issue) => ({ message: issue.message, ...(issue.path ? { path: issue.path.map((part) => typeof part === 'object' ? part.key : part).map((key) => typeof key === 'symbol' ? String(key) : key) } : {}) }));
    throw new WorkcoreError('VALIDATION_FAILED', issues.map((issue) => issue.message).join('; '), 400, issues);
  }
  return result.value;
}

export async function validateOutput(schema: AnySchema, value: unknown): Promise<unknown> {
  try { return await validate(schema, value); }
  catch (error) {
    if (error instanceof WorkcoreError && error.code === 'VALIDATION_FAILED') {
      throw new WorkcoreError('OUTPUT_VALIDATION_FAILED', 'Handler completed but returned a value that failed output validation; side effects may already have occurred', 500);
    }
    throw error;
  }
}

export function getJsonSchema(schema: AnySchema, direction: 'input' | 'output'): JsonSchema {
  const provider = schema as unknown as JsonSchemaProvider;
  if (!provider['~standard'].jsonSchema) throw new WorkcoreError('SCHEMA_CONVERSION_MISSING', 'Operation schema must implement Standard JSON Schema to appear in the admin manifest', 500);
  return provider['~standard'].jsonSchema[direction]({
    target: 'draft-2020-12',
    ...(provider['~standard'].vendor === 'zod' ? { libraryOptions: { unrepresentable: 'any' } } : {}),
  });
}

export function operationAt(definition: RuntimeDefinition, kind: OperationKind, name: string) {
  return (kind === 'query' ? definition.queries : kind === 'mutation' ? definition.mutations : definition.tasks)?.[name];
}

type CompiledOperation = {
  name: string;
  kind: OperationKind;
  input: JsonSchema;
  output: JsonSchema;
  definition: RuntimeOperation;
  presentation: CompiledOperationPresentation;
};
const catalogs = new WeakMap<RuntimeDefinition, readonly CompiledOperation[]>();

/** Static wire schemas are compiled at setup, never during actor-specific projection. */
export function compileOperationSchemas(definition: RuntimeDefinition): readonly CompiledOperation[] {
  const existing = catalogs.get(definition);
  if (existing) return existing;
  const schemas = new Map<AnySchema, Partial<Record<'input' | 'output', JsonSchema>>>();
  const read = (schema: AnySchema, direction: 'input' | 'output') => {
    const entry = schemas.get(schema) ?? {};
    entry[direction] ??= getJsonSchema(schema, direction);
    schemas.set(schema, entry);
    return entry[direction];
  };
  const operations: CompiledOperation[] = [];
  for (const [kind, map] of [['query', definition.queries], ['mutation', definition.mutations], ['task', definition.tasks]] as const) {
    for (const [name, operation] of Object.entries(map ?? {})) {
      if (operation.api !== true) continue;
      const renderer = kind === 'query' ? 'json' : 'form';
      const views = operation.views ?? { default: renderer, variants: { [renderer]: { title: name, renderer } } };
      operations.push({ name, kind, input: read(operation.input, 'input'), output: read(operation.output, 'output'), definition: operation, presentation: { ...views, operation: name, kind } });
    }
  }
  catalogs.set(definition, operations);
  return operations;
}
