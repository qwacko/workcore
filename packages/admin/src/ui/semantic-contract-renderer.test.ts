import { describe, expect, it } from 'vitest';
import { validateSemanticInterface, type WorkcoreManifest } from '@workcore/client';
import type { CollectionViewOptions } from '@workcore/core';
import { CollectionEditorController } from './collection-editor.js';
import { getCollectionFieldValue } from './collection-editor.js';

/** A deliberately non-Svelte, card-oriented renderer used as a contract harness. */
function renderCards(collection: CollectionViewOptions, rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({
    key: row[collection.itemKey],
      fields: collection.columns.map(({ field, label }) => ({ label: label ?? field, value: getCollectionFieldValue(row, field) ?? null })),
  }));
}

describe('renderer-independent semantic contract', () => {
  it('supports a card/editor arrangement without depending on the shipped table renderer', async () => {
    const collection: CollectionViewOptions = {
      itemKey: 'id',
      columns: [
        { field: 'title', label: 'Activity', editable: true },
        { field: 'status', label: 'Status', editable: true },
        { field: 'updatedAt', label: 'Updated', display: 'datetime' },
        { field: 'owner.name', label: 'Owner' },
      ],
      editor: { mutation: 'editActivity' },
    };
    const wire = {
      protocolVersion: 2,
      applicationId: 'renderer-contract',
      operations: [
        { name: 'activities', kind: 'query', input: { type: 'object', properties: {} }, output: { type: 'object', properties: {} } },
        { name: 'editActivity', kind: 'mutation', input: { type: 'object', properties: {} }, output: { type: 'object', properties: {} } },
      ],
      interface: {
        version: 1,
        requiredFeatures: ['collection-editor-v1', 'operation-views-v1'],
        operationViews: [
          { operation: 'activities', kind: 'query', default: 'manage', variants: { manage: { title: 'Activities', renderer: 'table' } } },
          { operation: 'editActivity', kind: 'mutation', default: 'form', variants: { form: { title: 'Edit activity', renderer: 'form' } } },
        ],
        pages: [],
        views: [{ operation: 'activities', kind: 'query', default: 'manage', variants: { manage: collection } }],
      },
    } as WorkcoreManifest;

    const document = validateSemanticInterface(wire);
    const emitted = document?.views?.[0]?.variants.manage;
    expect(emitted).toEqual(collection);
    if (!emitted) throw new Error('Expected validated collection view');

    const row = { id: 'activity-1', title: 'Plan release', status: 'planned', updatedAt: new Date('2026-10-15T12:00:00Z'), owner: { name: 'Ada' } };
    expect(renderCards(emitted, [row])).toEqual([{
      key: 'activity-1',
      fields: [
        { label: 'Activity', value: 'Plan release' },
        { label: 'Status', value: 'planned' },
        { label: 'Updated', value: row.updatedAt },
        { label: 'Owner', value: 'Ada' },
      ],
    }]);

    const editor = new CollectionEditorController(emitted);
    editor.refresh([row]);
    expect(editor.select(row)).toBe(true);
    editor.updateDraft({ id: 'activity-1', title: 'Release planned', status: 'complete' });
    let submitted: Record<string, unknown> | undefined;
    expect(await editor.submit(async (input) => { submitted = input; return input; })).toBe(true);
    expect(submitted).toEqual({ id: 'activity-1', title: 'Release planned', status: 'complete' });
    expect(submitted).not.toHaveProperty('updatedAt');
  });
});
