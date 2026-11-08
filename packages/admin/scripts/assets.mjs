import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Build-time helper. No monorepo paths or frontend build tools needed by consumers. */
export const adminAssetsDirectory = fileURLToPath(new URL('../build/', import.meta.url));
export async function copyAdminAssets(destination) {
  await cp(adminAssetsDirectory, destination, { recursive: true });
}
