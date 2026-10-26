import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const workerBindingNames = [
  'WORKCORE_AI_MODE', 'WORKCORE_AGENT_MODEL', 'WORKCORE_AGENT_FALLBACK_MODEL',
  'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENCODE_API_KEY',
];

/** Wrangler expands dollars even in quoted .env values. Preserve keys literally. */
export function workerEnvContents(environment) {
  return workerBindingNames.filter(name => environment[name] !== undefined).map(name => {
    const value = String(environment[name]);
    if (/[\r\n\0]/.test(value)) throw new Error(`${name} must be a single-line value`);
    // Single/backtick quotes preserve backslashes; double quotes interpret \n and \r.
    const quote = ["'", '`'].find(quote => !value.includes(quote));
    if (!quote) throw new Error(`${name} cannot contain both single quotes and backticks`);
    return `${name}=${quote}${value.replaceAll('$', '\\$')}${quote}\n`;
  }).join('');
}

/** A scoped, owner-only file keeps credentials out of command arguments and public vars. */
export function createWorkerEnvFile(environment, directory) {
  const contents = workerEnvContents(environment);
  const base = resolve(directory, '.wrangler');
  mkdirSync(base, { recursive: true });
  const temporary = mkdtempSync(join(base, 'worker-env-'));
  const path = join(temporary, 'bindings.env');
  writeFileSync(path, contents, { mode: 0o600 });
  let disposed = false;
  return { path, dispose() {
    if (disposed) return;
    disposed = true;
    unlinkSync(path);
    rmdirSync(temporary);
  } };
}
