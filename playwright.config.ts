import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4181', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `HOST=127.0.0.1 PORT=4181 WORKCORE_DATA=/tmp/opencode/workcore-e2e-tracker-${process.pid}.json WORKCORE_STATE=/tmp/opencode/workcore-e2e-state-${process.pid}.json pnpm dev`,
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
