import { getContext, setContext } from 'svelte';
import type { Json } from '@workcore/core';

export type RendererHost = {
  location(): URL;
  navigate(href: string, options?: { replace?: boolean }): void | Promise<void>;
  displayHref(name: string, input?: Record<string, Json>): string;
  runHref?(runId: string): string;
};
export const rendererHostKey = Symbol('workcore-renderer-host');

export function provideRendererHost(host: RendererHost): RendererHost {
  setContext(rendererHostKey, host);
  return host;
}
export function useRendererHost(): RendererHost {
  const host = getContext<RendererHost | undefined>(rendererHostKey);
  if (!host) throw new Error('A renderer host adapter must be provided when mounting a display renderer');
  return host;
}
