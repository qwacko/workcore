import type { Json, ManifestAction, SuccessEffect } from '@workcore/core';
import type { DisplayContext } from './display-context.svelte.js';
import type { RendererHost } from './host-context.svelte.js';
import { readPath } from './data.js';

export function runSuccessEffects(
  action: ManifestAction,
  result: Json,
  runtime: {
    displayContext: DisplayContext;
    host: RendererHost;
    refreshSources(): void;
    resetForm(): void;
  },
): Promise<void> {
  let refreshed = false;
  const navigate = async (display: string, bindings: Record<string, string>) => {
    const input: Record<string, Json> = {};
    for (const [field, path] of Object.entries(bindings)) {
      const value = readPath(result, path);
      if (value !== undefined) input[field] = value;
    }
    await runtime.host.navigate(runtime.host.displayHref(display, input));
  };
  const dispatch = async (effect: SuccessEffect) => {
    if (effect.type === 'state.set' || effect.type === 'state.reset' || effect.type === 'dialog.close') await runtime.displayContext.dispatchEffect(effect);
    else if (effect.type === 'form.reset') runtime.resetForm();
    else if (effect.type === 'source.refresh') { runtime.refreshSources(); refreshed = true; }
    else if (effect.type === 'navigate') await navigate(effect.display, effect.bind);
  };
  return (async () => {
    for (const effect of action.effects ?? []) await dispatch(effect);
    if (action.navigate) await navigate(action.navigate.display, action.navigate.bind);
    if (!refreshed) runtime.refreshSources();
  })();
}
