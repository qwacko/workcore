import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { admin, username } from 'better-auth/plugins';
import { db } from './db/index.js';
import * as schema from './db/schema.js';
import { authBaseURL, betterAuthTrustedOrigins } from './config.js';

export const auth = betterAuth({
  appName: 'Workcore Demo',
  baseURL: authBaseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? 'workcore-local-demo-secret-change-this-before-deploying',
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  plugins: [admin({ adminRoles: ['admin'] }), username({ displayUsername: false })],
  trustedOrigins: betterAuthTrustedOrigins,
});
