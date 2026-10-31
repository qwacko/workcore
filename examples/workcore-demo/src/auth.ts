import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';

export type AuthEnv = { AUTH_DB: D1Database; BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string; DEMO_MODE?: string };

/** Create per-request auth so Cloudflare bindings are never captured at module scope. */
export function createAuth(env: AuthEnv) {
  const secret = env.BETTER_AUTH_SECRET ?? (env.DEMO_MODE === 'true' ? 'workcore-local-demo-only-secret-change-before-deploy-32' : undefined);
  if (!secret || secret.length < 32) throw new Error('Set BETTER_AUTH_SECRET to a random value of at least 32 characters');
  const baseURL = env.BETTER_AUTH_URL?.trim();
  const trustedOrigins = baseURL ? [baseURL] : [];
  // Local reverse proxies can forward the public HTTPS request as HTTP. Keep
  // this compatibility origin confined to the local demo environment.
  if (baseURL && env.DEMO_MODE === 'true') {
    const canonicalOrigin = new URL(baseURL);
    trustedOrigins.push(`${canonicalOrigin.protocol === 'https:' ? 'http:' : 'https:'}//${canonicalOrigin.host}`);
  }
  return betterAuth({
    database: env.AUTH_DB,
    secret,
    baseURL,
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    trustedOrigins,
  });
}

/** Run Better Auth's built-in D1 schema migration before serving auth requests. */
export async function ensureAuthSchema(env: AuthEnv) {
  const auth = createAuth(env);
  const migrations = await getMigrations(auth.options);
  if (migrations.runMigrations) await migrations.runMigrations();
  return auth;
}

const authCache = new WeakMap<object, Promise<ReturnType<typeof createAuth>>>();
export function authFor(env: AuthEnv) {
  let pending = authCache.get(env);
  if (!pending) {
    pending = ensureAuthSchema(env);
    authCache.set(env, pending);
  }
  return pending;
}
