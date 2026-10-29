import type { Json, ManifestDocument } from '@workcore/core';

/** Reset a declared value through its state setter, preserving async persistence. */
export async function resetDisplayState(
  name: string,
  definitions: NonNullable<ManifestDocument['state']>,
  set: (address: string, value: Json) => void | Promise<void>,
): Promise<void> {
  const declaration = definitions[name];
  if (!declaration) throw new Error(`Unknown display state variable: ${name}`);
  await set(`state.${name}`, declaration.default);
}
