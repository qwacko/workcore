import { cp } from 'node:fs/promises';
await cp(new URL('../../../packages/admin/build/', import.meta.url), new URL('../build/admin-assets/', import.meta.url), { recursive: true });
