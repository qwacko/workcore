import type { HistoryEntry, Logger, PlatformOptions } from '../index.js';
import { safeMessage, WorkcoreError } from './errors.js';

export function randomId() { return globalThis.crypto.randomUUID(); }

export const consoleLogger: Logger = {
  debug: (message, fields) => console.debug(message, fields), info: (message, fields) => console.info(message, fields),
  warn: (message, fields) => console.warn(message, fields), error: (message, fields) => console.error(message, fields),
};

export async function safeHistory(options: PlatformOptions, entry: HistoryEntry): Promise<boolean> {
  try { await options.services.history.append(entry); return true; }
  catch (error) { options.services.logger?.error('Operation history persistence failed', { executionId: entry.id, detail: safeMessage(error) }); }
  return false;
}

export async function cleanupContext(context: unknown, logger?: Logger) {
  if (context && typeof context === 'object' && 'dispose' in context && typeof context.dispose === 'function') {
    const dispose = context.dispose as () => unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => dispose.call(context)),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Cleanup deadline exceeded')), 5_000); }),
      ]);
    } catch { logger?.error('Application context cleanup failed', { error: 'Cleanup hook failed or exceeded 5 seconds' }); }
    finally { if (timer) clearTimeout(timer); }
  }
}

export async function executeWithDeadline<T>(parent: AbortSignal, timeoutMs: number, execute: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
  if (parent.aborted) throw new WorkcoreError('EXECUTION_ABORTED', 'Operation was aborted; side effects may have occurred', 499);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abortFromParent, { once: true });
  let timedOut = false;
  const timeoutError = new WorkcoreError('OPERATION_TIMEOUT', 'Operation exceeded its configured time limit; side effects may have occurred', 504);
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const rejectOnAbort = () => rejectAbort(timedOut ? timeoutError : new WorkcoreError('EXECUTION_ABORTED', 'Operation was aborted; side effects may have occurred', 499));
  controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
  }, timeoutMs);
  try { return await Promise.race([Promise.resolve().then(() => execute(controller.signal)), aborted]); }
  finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', rejectOnAbort);
    parent.removeEventListener('abort', abortFromParent);
  }
}
