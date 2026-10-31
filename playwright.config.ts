import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://localhost:8788', browserName: 'chromium' },
  webServer: {
    command: `pnpm exec wrangler dev --config tests/browser/wrangler.jsonc --port 8788 --persist-to /tmp/opencode/workcore-e2e-${process.pid}`,
    url: 'http://localhost:8788',
    reuseExistingServer: false,
  },
});
