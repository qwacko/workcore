import type { CollectionViewOptions } from '@workcore/core';
import { fieldPath as getCollectionFieldValue } from './field-path.js';

export { getCollectionFieldValue };

/** Build a mutation input from only the declared identity/editable field mappings. */
export function mapCollectionEditorInput(collection: CollectionViewOptions, row: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const identity = collection.editor?.identity ?? { rowField: collection.itemKey, targetInput: 'id' };
  const identityValue = getCollectionFieldValue(row, identity.rowField);
  if (identityValue !== undefined) input[identity.targetInput] = identityValue;
  for (const column of collection.columns) {
    const target = column.editable === true ? column.field : typeof column.editable === 'object' ? column.editable.targetInput : undefined;
    if (target) {
      const value = getCollectionFieldValue(row, column.field);
      if (value !== undefined) input[target] = value;
    }
  }
  return input;
}

/** Equality for supported form data; unlike JSON comparison this preserves Date and rich nested values. */
export function sameEditorValue(left: unknown, right: unknown, seen = new WeakMap<object, object>(), depth = 0): boolean {
  if (Object.is(left, right)) return true;
  if (depth > 64 || !left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const prior = seen.get(left);
    if (prior) return prior === right;
    seen.set(left, right);
    return left.every((value, index) => sameEditorValue(value, right[index], seen, depth + 1));
  }
  if (Object.getPrototypeOf(left) !== Object.prototype && Object.getPrototypeOf(left) !== null) return false;
  if (Object.getPrototypeOf(right) !== Object.prototype && Object.getPrototypeOf(right) !== null) return false;
  const prior = seen.get(left);
  if (prior) return prior === right;
  seen.set(left, right);
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key)
    && sameEditorValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], seen, depth + 1));
}

export interface CollectionEditorSnapshot {
  selectedKey: string | null;
  selectedRecord: Record<string, unknown> | null;
  selectedMissing: boolean;
  draft: Record<string, unknown> | null;
  dirty: boolean;
  updateAvailable: boolean;
  submitting: boolean;
  error: string | null;
}

/** Framework-neutral selection/draft lifecycle for one collection instance. */
export class CollectionEditorController {
  private rows: Array<Record<string, unknown>> = [];
  private selectedKey: string | null = null;
  private selectedRecord: Record<string, unknown> | null = null;
  private selectedMissing = false;
  private draft: Record<string, unknown> | null = null;
  private initialDraft: Record<string, unknown> | null = null;
  private updateAvailable = false;
  private submitting = false;
  private error: string | null = null;
  private selectionGeneration = 0;

  constructor(private readonly collection: CollectionViewOptions) {
    if (!collection.editor) throw new TypeError('Collection editor controller requires an editor descriptor');
  }

  snapshot(): CollectionEditorSnapshot {
    return {
      selectedKey: this.selectedKey,
      selectedRecord: this.clone(this.selectedRecord),
      selectedMissing: this.selectedMissing,
      draft: this.clone(this.draft),
      dirty: this.isDirty(),
      updateAvailable: this.updateAvailable,
      submitting: this.submitting,
      error: this.error,
    };
  }

  refresh(rows: Array<Record<string, unknown>>): void {
    const indexed = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = this.keyOf(row);
      if (indexed.has(key)) throw new Error(`Collection contains duplicate identity '${key}'`);
      indexed.set(key, row);
    }
    this.rows = rows;
    if (this.selectedKey === null) return;
    const refreshed = indexed.get(this.selectedKey);
    if (!refreshed) {
      this.selectedMissing = true;
      this.updateAvailable = false;
      return;
    }
    this.selectedRecord = refreshed;
    this.selectedMissing = false;
    const nextDraft = mapCollectionEditorInput(this.collection, refreshed);
    if (!this.isDirty()) {
      this.initialDraft = this.clone(nextDraft);
      this.draft = this.clone(nextDraft);
      this.updateAvailable = false;
      this.error = null;
    } else {
      this.updateAvailable = !sameEditorValue(nextDraft, this.initialDraft);
    }
  }

  select(row: Record<string, unknown>, confirmDiscard: () => boolean = () => true): boolean {
    if (this.submitting) return false;
    const key = this.keyOf(row);
    if (this.selectedKey === key) return true;
    if (this.isDirty() && !confirmDiscard()) return false;
    if (this.rows.length) this.refresh(this.rows);
    this.selectionGeneration++;
    this.selectedKey = key;
    this.selectedRecord = row;
    this.selectedMissing = false;
    this.initialDraft = mapCollectionEditorInput(this.collection, row);
    this.draft = this.clone(this.initialDraft);
    this.updateAvailable = false;
    this.error = null;
    return true;
  }

  updateDraft(draft: Record<string, unknown>): void {
    if (!this.selectedRecord || this.submitting) return;
    this.draft = this.clone(draft);
    this.error = null;
  }

  discard(confirmDiscard: () => boolean = () => true): boolean {
    if (this.submitting || !this.selectedRecord) return false;
    if (this.isDirty() && !confirmDiscard()) return false;
    this.selectionGeneration++;
    this.selectedKey = null;
    this.selectedRecord = null;
    this.selectedMissing = false;
    this.draft = null;
    this.initialDraft = null;
    this.updateAvailable = false;
    this.error = null;
    return true;
  }

  /** Clear protected selection/draft state and invalidate any in-flight save reconciliation. */
  dispose(): void {
    this.selectionGeneration++;
    this.rows = [];
    this.selectedKey = null;
    this.selectedRecord = null;
    this.selectedMissing = false;
    this.draft = null;
    this.initialDraft = null;
    this.updateAvailable = false;
    this.submitting = false;
    this.error = null;
  }

  async submit(execute: (input: Record<string, unknown>) => Promise<unknown>): Promise<boolean> {
    if (this.submitting || !this.draft || !this.selectedRecord || this.selectedMissing) return false;
    const generation = this.selectionGeneration;
    const submitted = this.clone(this.draft)!;
    this.submitting = true;
    this.error = null;
    try {
      const result = await execute(this.clone(submitted)!);
      if (generation === this.selectionGeneration) {
        const savedRecord = result && typeof result === 'object' && !Array.isArray(result)
          ? result as Record<string, unknown>
          : { ...this.selectedRecord, ...submitted };
        this.selectedRecord = savedRecord;
        this.selectedMissing = false;
        this.initialDraft = mapCollectionEditorInput(this.collection, savedRecord);
        this.draft = this.clone(this.initialDraft);
        this.updateAvailable = false;
      }
      return true;
    } catch (cause) {
      if (generation === this.selectionGeneration) this.error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      this.submitting = false;
    }
  }

  private keyOf(row: Record<string, unknown>): string {
    const value = getCollectionFieldValue(row, this.collection.itemKey);
    if (value === undefined) throw new Error(`Collection row is missing identity field '${this.collection.itemKey}'`);
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Collection identity '${this.collection.itemKey}' must be a string or number`);
    return `${typeof value}:${String(value)}`;
  }

  private isDirty(): boolean {
    return this.draft !== null && this.initialDraft !== null && !sameEditorValue(this.draft, this.initialDraft);
  }

  private clone<T>(value: T): T {
    return cloneEditorValue(value, new WeakMap()) as T;
  }
}

function cloneEditorValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const entry of value) result.push(cloneEditorValue(entry, seen));
    return result;
  }
  if (value instanceof Map) {
    const result = new Map<unknown, unknown>();
    seen.set(value, result);
    for (const [key, entry] of value) result.set(cloneEditorValue(key, seen), cloneEditorValue(entry, seen));
    return result;
  }
  if (value instanceof Set) {
    const result = new Set<unknown>();
    seen.set(value, result);
    for (const entry of value) result.add(cloneEditorValue(entry, seen));
    return result;
  }
  const result = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  seen.set(value, result);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) continue;
    Object.defineProperty(result, key, { ...descriptor, value: cloneEditorValue(descriptor.value, seen) });
  }
  return result;
}
