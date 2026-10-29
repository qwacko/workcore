import { createRuntimeClient, createSources, createActionDispatcher } from '@workcore/client';
import type { Manifest } from '@workcore/core';
import type { Writable } from 'svelte/store';

export const sessionKey = Symbol('workcore-session');
export async function connect(workspace: string, onManifest?: (manifest: Manifest) => void) {
  const client = createRuntimeClient({ baseUrl: `/api/workspaces/${encodeURIComponent(workspace)}` });
  try {
    const manifest: Manifest = await client.manifest();
    const sources = createSources(client);
    const actions = createActionDispatcher(client);
    const manifestSubscription = client.subscribeManifest(state => { if (state.data) onManifest?.(state.data); });
    return { workspace, client, manifest, sources, actions, close() { manifestSubscription.unsubscribe(); actions.close(); sources.close(); client.close(); } };
  } catch (error) { client.close(); throw error; }
}
export type Session = Awaited<ReturnType<typeof connect>>;
export type SessionStore = Writable<Session | null>;
