import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const packageDirectories = ['core', 'client', 'files', 'ai', 'admin'];
const registry = 'https://registry.npmjs.org';
const root = fileURLToPath(new URL('../', import.meta.url));
const prereleasePart = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const versionPattern = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${prereleasePart}(?:\\.${prereleasePart})*))?$`);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const execute = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: 'pipe', ...options });

export function releaseVersion(tag) {
  assert.equal(typeof tag, 'string', 'Supply a v-prefixed release tag');
  assert(tag.startsWith('v') && versionPattern.test(tag.slice(1)), 'Use vX.Y.Z or vX.Y.Z-prerelease (no build metadata)');
  return tag.slice(1);
}
export function compareVersions(left, right) {
  const a = versionPattern.exec(left), b = versionPattern.exec(right);
  assert(a && b, 'Invalid registry version');
  for (let i = 1; i <= 3; i++) if (BigInt(a[i]) !== BigInt(b[i])) return BigInt(a[i]) > BigInt(b[i]) ? 1 : -1;
  if (a[4] === b[4]) return 0;
  if (!a[4] || !b[4]) return a[4] ? -1 : 1;
  const ap = a[4].split('.'), bp = b[4].split('.');
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) continue;
    if (ap[i] === undefined || bp[i] === undefined) return ap[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
    if (an && bn) return BigInt(ap[i]) > BigInt(bp[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ap[i] > bp[i] ? 1 : -1;
  }
  return 0;
}

export async function releaseConfig({ directory = root, tag, repository, event } = {}) {
  const version = releaseVersion(tag);
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ''), 'Supply the GitHub owner/repository');
  const distTag = version.includes('-') ? 'next' : 'latest';
  if (event?.release) {
    assert.equal(event.action, 'published', 'Only published release events can release packages');
    assert.equal(event.release.draft, false, 'Drafts cannot publish');
    assert.equal(event.release.tag_name, tag, 'Release event tag mismatch');
    assert.equal(event.release.prerelease, distTag === 'next', 'GitHub prerelease flag must match the package version');
  }
  const packages = [];
  for (const folder of packageDirectories) {
    const metadata = await json(join(directory, 'packages', folder, 'package.json'));
    assert.equal(metadata.version, version, `${metadata.name}: tag/version mismatch`);
    assert.notEqual(metadata.private, true, `${metadata.name} is private`);
    assert.equal(metadata.publishConfig?.access, 'public', `${metadata.name}: public access must be explicit`);
    assert.equal(metadata.repository?.url, `git+https://github.com/${repository}.git`, `${metadata.name}: repository must match GitHub for trusted publishing`);
    assert.equal(metadata.repository.directory, `packages/${folder}`);
    assert(/^@[a-z0-9_-]+\/[a-z0-9_-]+$/.test(metadata.name), 'Expected a scoped package name');
    const file = `${metadata.name.slice(1).replace('/', '-')}-${version}.tgz`;
    packages.push({ name: metadata.name, folder, file });
  }
  assert.equal(new Set(packages.map(pkg => pkg.name)).size, packageDirectories.length);
  const notes = await readFile(join(directory, 'CHANGELOG.md'), 'utf8');
  const heading = notes.split('\n').find(line => line.startsWith(`## ${version} `) || line === `## ${version}`);
  assert(heading, 'Add a changelog heading for this version');
  if (event?.release) assert(!/unreleased/i.test(heading), 'Finalize the changelog date before publishing a GitHub Release');
  return { tag, version, distTag, repository, packages };
}

export function validatePacked(metadata, pkg, config) {
  assert.equal(metadata.name, pkg.name);
  assert.equal(metadata.version, config.version);
  assert.notEqual(metadata.private, true);
  assert.equal(metadata.repository?.url, `git+https://github.com/${config.repository}.git`);
  assert(!JSON.stringify(metadata.exports).includes('./src/'), 'Packed exports still reference TypeScript sources');
  assert(!JSON.stringify(metadata.dependencies ?? {}).includes('workspace:'), 'Packed dependencies still use workspace protocols');
  for (const dependency of config.packages) {
    if (metadata.dependencies?.[dependency.name]) assert.equal(metadata.dependencies[dependency.name], config.version, 'Internal package versions must release together');
  }
}

export async function packRelease(config, directory, commit, source = root) {
  await mkdir(directory, { recursive: true });
  assert.equal((await readdir(directory)).length, 0, 'Use an empty output directory; do not overwrite release artifacts');
  const packages = [];
  for (const pkg of config.packages) {
    execute('pnpm', ['pack', '--pack-destination', directory], { cwd: join(source, 'packages', pkg.folder) });
    const path = join(directory, pkg.file);
    validatePacked(JSON.parse(execute('tar', ['-xOf', path, 'package/package.json']).toString()), pkg, config);
    packages.push({ name: pkg.name, file: pkg.file, integrity: integrity(await readFile(path)) });
  }
  const manifest = { format: 1, tag: config.tag, version: config.version, distTag: config.distTag, repository: config.repository, commit, packages };
  await writeFile(join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export async function verifyArtifacts(config, directory, commit) {
  const manifest = await json(join(directory, 'release-manifest.json'));
  for (const [key, expected] of Object.entries({ format: 1, tag: config.tag, version: config.version, distTag: config.distTag, repository: config.repository, commit })) assert.equal(manifest[key], expected, `Artifact ${key} mismatch`);
  assert.equal(manifest.packages.length, config.packages.length);
  for (const [index, pkg] of config.packages.entries()) {
    const entry = manifest.packages[index];
    assert.equal(entry.name, pkg.name);
    assert.equal(entry.file, pkg.file);
    assert.equal(basename(entry.file), entry.file);
    const path = join(directory, entry.file);
    assert.equal(integrity(await readFile(path)), entry.integrity, `${pkg.name}: artifact integrity mismatch`);
    validatePacked(JSON.parse(execute('tar', ['-xOf', path, 'package/package.json']).toString()), pkg, config);
  }
  return manifest;
}

export async function registryMetadata(name, request = fetch) {
  const response = await request(`${registry}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  assert.equal(response.status, 200, `${name}: registry request failed (${response.status}); refusing to assume it is unpublished`);
  const metadata = await response.json();
  assert.equal(metadata.name, name, 'Unexpected registry package');
  assert(metadata.versions && metadata['dist-tags'], 'Invalid registry metadata');
  return metadata;
}
export function publicationPlan(manifest, metadata) {
  return manifest.packages.map((pkg, index) => {
    const remote = metadata[index];
    const existing = remote?.versions[manifest.version];
    if (existing) {
      assert.equal(existing.dist?.integrity, pkg.integrity, `${pkg.name}@${manifest.version} exists with DIFFERENT bytes. Do not overwrite it; recover the original artifacts or choose a new version.`);
      return { ...pkg, skip: true };
    }
    const current = remote?.['dist-tags'][manifest.distTag];
    if (current) assert(compareVersions(manifest.version, current) >= 0, `${pkg.name}: refusing to move ${manifest.distTag} backwards from ${current}`);
    return { ...pkg, skip: false };
  });
}
export async function publishRelease(manifest, directory, { request = fetch, publish = path => execute('npm', ['publish', path, '--ignore-scripts', '--access', 'public', '--tag', manifest.distTag, `--registry=${registry}`], { stdio: 'inherit' }) } = {}) {
  // Preflight EVERY package before any publication; five npm publishes are not atomic.
  const plan = publicationPlan(manifest, await Promise.all(manifest.packages.map(pkg => registryMetadata(pkg.name, request))));
  for (const pkg of plan) {
    if (pkg.skip) { console.log(`Already published, integrity verified: ${pkg.name}@${manifest.version}`); continue; }
    await publish(join(directory, pkg.file));
    const remote = await registryMetadata(pkg.name, request);
    assert.equal(remote?.versions[manifest.version]?.dist?.integrity, pkg.integrity, 'Published version not yet visible with expected integrity; rerun the failed job after checking npm');
    assert.equal(remote?.['dist-tags'][manifest.distTag], manifest.version, 'Unexpected npm dist-tag after publishing');
  }
}
export function assertReleaseEvent(environment, tag) {
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'Automated publication/attachment is restricted to GitHub Actions');
  assert.equal(environment.GITHUB_EVENT_NAME, 'release', 'Manual verification runs cannot publish or attach');
  assert.equal(environment.GITHUB_REF, `refs/tags/${tag}`, 'Only the matching release tag may publish');
}

async function attachRelease(config, directory) {
  const release = JSON.parse(execute('gh', ['api', `repos/${config.repository}/releases/tags/${encodeURIComponent(config.tag)}`]).toString());
  assert.equal(release.draft, false);
  assert.equal(release.tag_name, config.tag);
  assert.equal(release.prerelease, config.distTag === 'next');
  const files = [...config.packages.map(pkg => pkg.file), 'release-manifest.json'];
  const missing = [];
  for (const file of files) {
    const asset = release.assets.find(asset => asset.name === file);
    if (!asset) { missing.push(join(directory, file)); continue; }
    const remote = execute('gh', ['api', `repos/${config.repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream']);
    assert.equal(integrity(remote), integrity(await readFile(join(directory, file))), `${file}: GitHub asset differs; refusing to replace it`);
  }
  if (missing.length) execute('gh', ['release', 'upload', config.tag, ...missing, '--repo', config.repository], { stdio: 'inherit' });
}

async function main() {
  const command = process.argv[2];
  const value = flag => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
  const tag = value('--tag') ?? process.env.RELEASE_TAG;
  const repository = process.env.GITHUB_REPOSITORY ?? 'qwacko/workcore';
  const event = process.env.GITHUB_EVENT_PATH ? await json(process.env.GITHUB_EVENT_PATH) : undefined;
  const config = await releaseConfig({ tag, repository, event });
  const directory = resolve(value('--directory') ?? join(root, 'release'));
  const commit = execute('git', ['rev-parse', 'HEAD']).toString().trim();
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'release') assert.equal(commit, process.env.GITHUB_SHA, 'The tag moved after this workflow was triggered; refusing to release a different commit');
  if (command === 'check') { console.log(`Validated ${tag} (${config.distTag}), ${config.packages.length} packages`); return; }
  if (command === 'pack') { await packRelease(config, directory, commit); return; }
  const manifest = await verifyArtifacts(config, directory, commit);
  if (command === 'verify') return;
  if (command === 'attach' || command === 'publish') {
    assertReleaseEvent(process.env, tag);
  }
  if (command === 'attach') { await attachRelease(config, directory); return; }
  if (command === 'publish') {
    assert(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'OIDC permission is missing');
    assert(!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN, 'Use OIDC, not a stored npm token');
    const npmVersion = execute('npm', ['--version']).toString().trim();
    assert(compareVersions(npmVersion, '11.5.1') >= 0, 'Upgrade npm for trusted publishing');
    // Public GitHub repositories receive npm provenance automatically via OIDC.
    if (event.repository.private) process.env.NPM_CONFIG_PROVENANCE = 'false';
    await publishRelease(manifest, directory);
    return;
  }
  throw new Error('Use check, pack, verify, attach or publish');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
