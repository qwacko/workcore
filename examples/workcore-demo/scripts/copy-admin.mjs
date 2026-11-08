import { copyAdminAssets } from '@workcore/admin/assets';
await copyAdminAssets(new URL('../build/admin-assets/', import.meta.url));
