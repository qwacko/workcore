/** Reserved invalidation keys emitted by Workcore-owned state changes. */
export const builtinTriggers = {
  files: '$workcore:files',
  runs: '$workcore:runs',
  schedules: '$workcore:schedules',
  history: '$workcore:history',
  kv: '$workcore:kv',
} as const;

export type BuiltinTriggerKey = typeof builtinTriggers[keyof typeof builtinTriggers];
export type TriggerKey = string | BuiltinTriggerKey;
export type Trigger = TriggerKey | '*';

/** True when a changed-key set should cause a view snapshot to be recomputed. */
export function shouldRefreshView(dependencies: readonly string[] | undefined, changed: ReadonlySet<string>): boolean {
  if (changed.has('*') || dependencies === undefined || dependencies.includes('*')) return true;
  return dependencies.some(key => changed.has(key));
}
