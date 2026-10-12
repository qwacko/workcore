import { defineWorkspace, type RequestContext } from '@workcore/core';
import { auth } from './auth.js';
import { z } from 'zod';

export type IdentityContext = { auth: typeof auth };

const authorizationContext = z.object({ isAdmin: z.boolean() });
const identityUser = z.object({ id: z.string(), username: z.string().nullable(), name: z.string(), email: z.string(), role: z.enum(['admin', 'user']) });
type BetterAuthUser = Awaited<ReturnType<typeof auth.api.listUsers>>['users'][number];
const usersInput = z.object({ limit: z.number().int().min(1).max(100).default(25), cursor: z.string().regex(/^\d+$/).optional() });
const setRoleInput = z.object({ id: z.string().min(1), role: z.enum(['admin', 'user']) });
const setNameInput = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(100) });

function requireHeaders(request?: RequestContext) {
  if (!request) throw new Error('Identity administration requires an HTTP request');
  return request.headers;
}

function toIdentityUser(user: BetterAuthUser) {
  return {
    id: user.id,
    // The username plugin adds this field at runtime; Better Auth's admin API type omits plugin fields.
    username: (user as BetterAuthUser & { username?: string | null }).username ?? null,
    name: user.name,
    email: user.email,
    role: user.role === 'admin' ? 'admin' as const : 'user' as const,
  };
}

export const identity = defineWorkspace<IdentityContext>()({
  id: 'identity',
  authorization: {
    context: authorizationContext,
    check: ({ auth }) => auth.isAdmin,
  },
  queries: {
    users: {
      input: usersInput,
      output: z.object({ rows: z.array(identityUser), nextCursor: z.string().nullable(), totalCount: z.number() }),
      permission: 'identity.users.read',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Users', renderer: 'table', rowKey: 'id', columns: ['username', 'name', 'email', 'role'], actions: [
        { label: 'Change name', mutation: 'setUserName', variant: 'basic', bind: { id: { fromRow: 'id' }, name: { fromRow: 'name' } } },
        { label: 'Change role', mutation: 'setUserRole', variant: 'basic', bind: { id: { fromRow: 'id' }, role: { fromRow: 'role' } } },
      ] } } },
      handler: async ({ ctx, input }) => {
        const offset = Number(input.cursor ?? 0);
        const page = await ctx.app.auth.api.listUsers({
          query: { limit: input.limit, offset },
          headers: requireHeaders(ctx.request),
        });
        const rows = page.users.map(toIdentityUser);
        const next = offset + rows.length;
        return { rows, nextCursor: next < page.total ? String(next) : null, totalCount: page.total };
      },
    },
  },
  mutations: {
    setUserName: {
      input: setNameInput,
      output: identityUser,
      permission: 'identity.users.manage',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Change user name', renderer: 'form' } } },
      handler: async ({ ctx, input }) => {
        const updated = await ctx.app.auth.api.adminUpdateUser({
          body: { userId: input.id, data: { name: input.name } },
          headers: requireHeaders(ctx.request),
        });
        return toIdentityUser(updated);
      },
    },
    setUserRole: {
      input: setRoleInput,
      output: identityUser,
      permission: 'identity.users.manage',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Change account role', renderer: 'form' } } },
      handler: async ({ ctx, input }) => {
        const headers = requireHeaders(ctx.request);
        if (input.role === 'user') {
          // Check all pages so this example does not accidentally remove the final admin.
          let offset = 0;
          let totalAdmins = 0;
          let targetIsAdmin = false;
          while (true) {
            const page = await ctx.app.auth.api.listUsers({ query: { limit: 100, offset }, headers });
            for (const candidate of page.users) {
              if (candidate.role === 'admin') totalAdmins += 1;
              if (candidate.id === input.id && candidate.role === 'admin') targetIsAdmin = true;
            }
            offset += page.users.length;
            if (page.users.length === 0 || offset >= page.total) break;
          }
          if (targetIsAdmin && totalAdmins === 1) throw new Error('Cannot remove the last administrator');
        }
        const { user } = await ctx.app.auth.api.setRole({
          body: { userId: input.id, role: input.role },
          headers,
        });
        return toIdentityUser(user);
      },
    },
  },
});
