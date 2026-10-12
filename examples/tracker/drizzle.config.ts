import './src/load-env.js';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.WORKCORE_DATABASE ?? 'data/workcore.sqlite' },
});
