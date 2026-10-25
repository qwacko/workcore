import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { parseEnv } from 'node:util';

/** Later files win; exported shell variables take precedence over every file. */
export function readEnvironment(files, inherited = process.env) {
  const environment = {};
  for (const file of files) {
    try { Object.assign(environment, parseEnv(readFileSync(file, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { ...environment, ...inherited };
}

export function devArgs(environment) {
  const ip = environment.HOST ?? '127.0.0.1';
  const port = environment.PORT ?? '8787';
  if (!isIP(ip)) throw new Error('HOST must be an IPv4 or IPv6 listening address');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('PORT must be between 1 and 65535');
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', isIP(ip) === 6 ? `[${ip}]` : ip]);
  for (const entry of (environment.DEMO_ALLOWED_HOSTS ?? '').split(',')) {
    const host = entry.trim().toLowerCase();
    if (!host) continue;
    let parsed;
    try { parsed = new URL(`http://${host}`); } catch { /* handled by validation below */ }
    if (!parsed || parsed.hostname !== host || parsed.port || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash || host.includes('*')) {
      throw new Error('DEMO_ALLOWED_HOSTS must contain exact hostnames only, without protocols, paths, ports or wildcards');
    }
    hosts.add(host);
  }
  return ['dev', '--env', 'local', '--ip', ip, '--port', String(Number(port)), '--var', `DEMO_ALLOWED_HOSTS:${[...hosts].join(',')}`];
}
