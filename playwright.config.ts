import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const persistencePath = join(tmpdir(), `workcore-e2e-${process.pid}`);
const persistenceArgument = "'" + persistencePath.replace(/'/g, "'\\''") + "'";

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://localhost:8788', browserName: 'chromium' },
  webServer: {
    command: `pnpm exec wrangler dev --config tests/browser/wrangler.jsonc --port 8788 --persist-to ${persistenceArgument}`,
    url: 'http://localhost:8788',
    reuseExistingServer: false,
  },
});
