import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { devArgs, readEnvironment } from './dev-config.mjs';

const require = createRequire(import.meta.url);
const example = new URL('../examples/tracker/', import.meta.url);
const environment = readEnvironment([new URL('../.env', import.meta.url), new URL('.env', example)]);
const wrangler = resolve(dirname(require.resolve('wrangler/package.json')), require('wrangler/package.json').bin.wrangler);
const args = devArgs(environment);
const root = fileURLToPath(new URL('../', import.meta.url));
const built = spawnSync('pnpm', ['--filter', '@workcore/admin', 'build'], { cwd: root, env: environment, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const backendPort = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(error => error ? reject(error) : resolvePort(port));
  });
});
const host = args[args.indexOf('--ip') + 1];
const port = args[args.indexOf('--port') + 1];
args[args.indexOf('--ip') + 1] = '127.0.0.1';
args[args.indexOf('--port') + 1] = String(backendPort);
const backend = spawn(process.execPath, [wrangler, ...args, ...process.argv.slice(2)], { cwd: fileURLToPath(example), env: environment, stdio: 'inherit' });
const frontend = spawn('pnpm', ['--filter', '@workcore/admin', 'dev'], {
  cwd: root, env: { ...environment, HOST: host, PORT: port, WORKCORE_API_ORIGIN: `http://127.0.0.1:${backendPort}` }, stdio: 'inherit',
});
console.log(`Workcore: http://${host}:${port} (SvelteKit HMR + local Cloudflare runtime)`);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true; process.exitCode = code;
  backend.kill('SIGTERM'); frontend.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of [backend, frontend]) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code ?? 1));
}
