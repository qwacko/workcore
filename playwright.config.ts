import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://localhost:8788', browserName: 'chromium' },
  webServer: {
    command: `pnpm --filter @workcore/example exec wrangler dev --env local --var WORKCORE_AI_MODE:demo --port 8788 --persist-to /tmp/opencode/workcore-e2e-${process.pid}`,
    url: 'http://localhost:8788',
    reuseExistingServer: false,
  },
});
