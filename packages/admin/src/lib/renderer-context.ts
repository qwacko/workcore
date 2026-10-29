import type { Component } from 'svelte';
import type { Json } from '@workcore/core';
import { getContext } from 'svelte';
import { get } from 'svelte/store';
import type { Sources } from '@workcore/client';
import { sessionKey, type SessionStore } from './session.js';

/** Local renderer implementations; only component identifiers and validated JSON travel over the wire. */
export type RendererRegistry = Record<string, Component<any>>;
export type RendererRegistryContext = () => RendererRegistry;
export const rendererRegistryKey = Symbol('workcore-renderer-registry');

/** Access the host's shared source manager from a custom Svelte renderer component. */
export function useRendererSources(): Sources | null {
  const session = getContext<SessionStore>(sessionKey);
  return get(session)?.sources ?? null;
}

export type CellRendererProps = { value: Json; row: Json; column: Json; input: Json };
export type FieldRendererProps = {
  value: unknown;
  schema: Json;
  name: string;
  label: string;
  path: string;
  required: boolean;
  disabled: boolean;
  error?: string;
  onchange(value: unknown): void;
};
