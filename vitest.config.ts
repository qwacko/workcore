import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './tests/wrangler.jsonc' } })],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15_000 },
});
