import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devArgs, readEnvironment } from './dev-config.mjs';

const require = createRequire(import.meta.url);
const example = new URL('../examples/tracker/', import.meta.url);
const environment = readEnvironment([new URL('../.env', import.meta.url), new URL('.env', example)]);
const wrangler = resolve(dirname(require.resolve('wrangler/package.json')), require('wrangler/package.json').bin.wrangler);
const child = spawn(process.execPath, [wrangler, ...devArgs(environment), ...process.argv.slice(2)], {
  cwd: fileURLToPath(example), env: environment, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
