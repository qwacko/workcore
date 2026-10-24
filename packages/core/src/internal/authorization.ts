import type { Actor, ApplicationRegistration, Permission, PlatformOptions, Scope } from '../index.js';
import { WorkcoreError } from './errors.js';
import { validate } from './schema.js';

type PolicyDefinition = { permission?: Permission<unknown, unknown> };

export async function authoriseOperation(registration: ApplicationRegistration, def: PolicyDefinition, actor: Actor, scope: Scope, input: unknown, options: PlatformOptions) {
  const policy = def.permission;
  if (policy === undefined) throw new WorkcoreError('FORBIDDEN', 'Operation has no permission policy', 403);
  if (typeof policy === 'function') {
    if (!await policy({ actor, scope, input, access: { has: (capability) => canCapability(registration, options, actor, scope, capability, input) } })) throw new WorkcoreError('FORBIDDEN', 'Operation permission denied', 403);
    return;
  }
  // Empty policies explicitly require no capability; membership is checked separately.
  for (const permission of typeof policy === 'string' ? [policy] : policy) {
    if (!await canCapability(registration, options, actor, scope, permission, input)) throw new WorkcoreError('FORBIDDEN', 'Operation permission denied', 403);
  }
}

async function checkCapability(registration: ApplicationRegistration, options: PlatformOptions, actor: Actor, scope: Scope, permission: string, input: unknown, resolveContext: () => Promise<unknown>) {
  let hasAuthorizer = false;
  if (options.authorise) {
    hasAuthorizer = true;
    if (!await options.authorise({ actor, scope, permission, input })) return false;
  }
  const authorization = registration.definition.authorization;
  if (authorization) {
    hasAuthorizer = true;
    if (!registration.resolveAuthorization) return false;
    const auth = await resolveContext();
    if (!await authorization.check({ auth, actor, scope, permission, input })) return false;
  }
  return hasAuthorizer;
}

export function canCapability(registration: ApplicationRegistration, options: PlatformOptions, actor: Actor, scope: Scope, permission: string, input: unknown) {
  return checkCapability(registration, options, actor, scope, permission, input, async () => validate(registration.definition.authorization!.context, await registration.resolveAuthorization!({ actor, scope })));
}

/** One authorization snapshot per manifest request, never shared with execution or later requests. */
export function createManifestAccess(registration: ApplicationRegistration, options: PlatformOptions, actor: Actor, scope: Scope) {
  let context: Promise<unknown> | undefined;
  const capabilities = new Map<string, Promise<boolean>>();
  const has = (permission: string) => {
    let result = capabilities.get(permission);
    if (!result) {
      result = checkCapability(registration, options, actor, scope, permission, undefined, () => context ??= Promise.resolve(registration.resolveAuthorization!({ actor, scope })).then((value) => validate(registration.definition.authorization!.context, value)));
      capabilities.set(permission, result);
    }
    return result;
  };
  return { has, visible: (definition: PolicyDefinition) => permissionVisible(definition, has) };
}

/** Callback policies are input-aware and can only be decided at execution. */
async function permissionVisible(definition: PolicyDefinition, has: (permission: string) => Promise<boolean>) {
  const policy = definition.permission;
  if (policy === undefined) return false;
  if (typeof policy === 'function') return true;
  for (const permission of typeof policy === 'string' ? [policy] : policy) {
    if (!await has(permission)) return false;
  }
  return true;
}
