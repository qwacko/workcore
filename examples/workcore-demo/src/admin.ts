/** Operator-configured Better Auth user IDs, not email addresses or request headers. */
export function isConfiguredAdmin(env: { WORKCORE_ADMIN_IDS?: string }, actorId: string): boolean {
  return !!actorId && (env.WORKCORE_ADMIN_IDS ?? '').split(',').some(id => id.trim() === actorId);
}
