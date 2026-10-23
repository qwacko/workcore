import { describe, expect, it } from 'vitest';
import { CollectionEditorController, getCollectionFieldValue, mapCollectionEditorInput, sameEditorValue } from './collection-editor.js';

describe('semantic collection editor mapping', () => {
  it('submits only identity and explicitly editable columns', () => {
    const collection = {
      itemKey: 'id',
      columns: [
        { field: 'title', editable: true },
        { field: 'status', editable: { targetInput: 'state' } },
        { field: 'updatedAt', editable: false },
      ],
      editor: { mutation: 'edit', identity: { rowField: 'id', targetInput: 'activityId' } },
    } as const;
    const row = { id: 'a1', title: 'Ride', status: 'planned', updatedAt: new Date('2026-10-15T00:00:00.000Z'), secret: 'not submitted' };
    expect(mapCollectionEditorInput(collection, row)).toEqual({ activityId: 'a1', title: 'Ride', state: 'planned' });
  });

  it('reads safe nested object and array paths for display and explicit editor mappings', () => {
    const collection = {
      itemKey: 'id',
      columns: [
        { field: 'customer.name', editable: { targetInput: 'customerName' } },
        { field: 'items.0.sku', editable: false },
      ],
      editor: { mutation: 'edit' },
    } as const;
    const row = { id: 'a1', customer: { name: 'Ada' }, items: [{ sku: 'sku-1' }] };
    expect(getCollectionFieldValue(row, 'customer.name')).toBe('Ada');
    expect(getCollectionFieldValue(row, 'items.0.sku')).toBe('sku-1');
    expect(getCollectionFieldValue(row, 'customer.__proto__')).toBeUndefined();
    expect(getCollectionFieldValue(row, 'items.01.sku')).toBeUndefined();
    expect(mapCollectionEditorInput(collection, row)).toEqual({ id: 'a1', customerName: 'Ada' });
  });

  it('supports validated nested identities for editor mapping and stable selection', () => {
    const collection = {
      itemKey: 'owner.id',
      columns: [{ field: 'title', editable: true }],
      editor: { mutation: 'edit', identity: { rowField: 'owner.id', targetInput: 'ownerId' } },
    } as const;
    const row = { owner: { id: 'owner-1' }, title: 'Nested identity' };
    expect(mapCollectionEditorInput(collection, row)).toEqual({ ownerId: 'owner-1', title: 'Nested identity' });
    const controller = new CollectionEditorController(collection);
    controller.refresh([row]);
    expect(controller.select(row)).toBe(true);
    expect(controller.snapshot()).toMatchObject({ selectedKey: 'string:owner-1', draft: { ownerId: 'owner-1', title: 'Nested identity' } });
  });

  it('compares rich values without JSON cloning or stringification', () => {
    expect(sameEditorValue({ when: new Date('2026-10-15T00:00:00.000Z'), nested: [1, false] }, { when: new Date('2026-10-15T00:00:00.000Z'), nested: [1, false] })).toBe(true);
    expect(sameEditorValue({ when: new Date('2026-10-15T00:00:00.000Z') }, { when: '2026-10-15T00:00:00.000Z' })).toBe(false);
  });

  it('preserves dirty drafts over refresh and reports update availability', () => {
    const collection = { itemKey: 'id', columns: [{ field: 'title', editable: true }], editor: { mutation: 'edit' } } as const;
    const controller = new CollectionEditorController(collection);
    const original = { id: 'a1', title: 'Original', updatedAt: new Date('2026-10-01T00:00:00.000Z') };
    expect(controller.snapshot()).toMatchObject({ selectedKey: null, draft: null, dirty: false });
    controller.refresh([original]);
    expect(controller.select(original)).toBe(true);
    controller.updateDraft({ id: 'a1', title: 'My draft' });
    controller.refresh([{ ...original, title: 'New server value', updatedAt: new Date('2026-10-02T00:00:00.000Z') }]);
    expect(controller.snapshot()).toMatchObject({ draft: { id: 'a1', title: 'My draft' }, dirty: true, updateAvailable: true });
  });

  it('keeps failed submissions local and resets the draft only after success', async () => {
    const collection = { itemKey: 'id', columns: [{ field: 'title', editable: true }], editor: { mutation: 'edit' } } as const;
    const controller = new CollectionEditorController(collection);
    controller.refresh([{ id: 'a1', title: 'Original' }]);
    controller.select({ id: 'a1', title: 'Original' });
    controller.updateDraft({ id: 'a1', title: 'Changed' });
    expect(await controller.submit(async () => { throw new Error('validation failed'); })).toBe(false);
    expect(controller.snapshot()).toMatchObject({ draft: { title: 'Changed' }, dirty: true, error: 'validation failed', submitting: false });
    expect(await controller.submit(async (input) => ({ ...input, updatedAt: new Date() }))).toBe(true);
    expect(controller.snapshot()).toMatchObject({ draft: { id: 'a1', title: 'Changed' }, dirty: false, error: null, submitting: false });
  });

  it('identifies deleted rows and diagnoses duplicate or missing stable keys', () => {
    const collection = { itemKey: 'id', columns: [{ field: 'title', editable: true }], editor: { mutation: 'edit' } } as const;
    const controller = new CollectionEditorController(collection);
    controller.refresh([{ id: 'a1', title: 'Original' }]);
    controller.select({ id: 'a1', title: 'Original' });
    controller.refresh([]);
    expect(controller.snapshot().selectedMissing).toBe(true);
    expect(() => controller.refresh([{ id: 'same', title: 'A' }, { id: 'same', title: 'B' }])).toThrow(/duplicate identity/);
    expect(() => controller.select({ title: 'No id' })).toThrow(/missing identity/);
  });

  it('clears protected drafts on disposal and ignores late save reconciliation', async () => {
    const collection = { itemKey: 'id', columns: [{ field: 'title', editable: true }], editor: { mutation: 'edit' } } as const;
    const controller = new CollectionEditorController(collection);
    controller.refresh([{ id: 'a1', title: 'Private record' }]);
    controller.select({ id: 'a1', title: 'Private record' });
    controller.updateDraft({ id: 'a1', title: 'Private draft' });
    let resolveSave!: (value: unknown) => void;
    const pending = controller.submit(() => new Promise((resolve) => { resolveSave = resolve; }));

    controller.dispose();
    expect(controller.snapshot()).toEqual({ selectedKey: null, selectedRecord: null, selectedMissing: false, draft: null, dirty: false, updateAvailable: false, submitting: false, error: null });
    resolveSave({ id: 'a1', title: 'Saved after access loss' });
    await expect(pending).resolves.toBe(true);
    expect(controller.snapshot().selectedRecord).toBeNull();
    expect(controller.snapshot().draft).toBeNull();
  });

  it('snapshots framework proxies without relying on structuredClone', () => {
    const collection = { itemKey: 'id', columns: [{ field: 'title', editable: true }], editor: { mutation: 'edit' } } as const;
    const controller = new CollectionEditorController(collection);
    const proxyRow = new Proxy({ id: 'a1', title: 'Proxy row', updatedAt: new Date('2026-10-01T00:00:00.000Z') }, {});
    controller.refresh([proxyRow]);
    expect(controller.select(proxyRow)).toBe(true);
    expect(controller.snapshot()).toMatchObject({ selectedRecord: { id: 'a1', title: 'Proxy row' }, draft: { id: 'a1', title: 'Proxy row' } });
  });
});
