import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { assertReleaseEvent, compareVersions, packageDirectories, publicationPlan, publishRelease, registryMetadata, releaseConfig, releaseVersion, validatePacked, verifyArtifacts } from './release.mjs';

const sri = value => `sha512-${createHash('sha512').update(value).digest('base64')}`;
const pkg = { name: '@workcore/core', file: 'workcore-core-0.1.0.tgz', integrity: sri('core') };
const manifest = { version: '0.1.0', distTag: 'latest', packages: [pkg] };
const metadata = (integrity = pkg.integrity, version = '0.1.0') => ({ name: pkg.name, versions: { [version]: { dist: { integrity } } }, 'dist-tags': { latest: version } });

test('release tags are strict semver and prereleases sort correctly', () => {
  assert.equal(releaseVersion('v0.1.0'), '0.1.0');
  assert.equal(releaseVersion('v0.2.0-rc.1'), '0.2.0-rc.1');
  for (const value of ['main', '0.1.0', 'v01.1.0', 'v0.1.0-01', 'v0.1.0+build', 'v0.1.0;echo bad']) assert.throws(() => releaseVersion(value));
  for (const [left, right] of [['0.1.0', '0.1.1'], ['0.1.0-rc.2', '0.1.0-rc.10'], ['0.1.0-alpha', '0.1.0-beta'], ['0.1.0-rc.1', '0.1.0'], ['0.1.0-1', '0.1.0-alpha'], ['0.1.0-rc', '0.1.0-rc.1']]) {
    assert.equal(compareVersions(left, right), -1);
    assert.equal(compareVersions(right, left), 1);
  }
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
});

test('manual verification and non-tag contexts cannot publish or attach assets', () => {
  const context = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'release', GITHUB_REF: 'refs/tags/v0.1.0' };
  assertReleaseEvent(context, 'v0.1.0');
  assert.throws(() => assertReleaseEvent({ ...context, GITHUB_EVENT_NAME: 'workflow_dispatch' }, 'v0.1.0'), /Manual verification/);
  assert.throws(() => assertReleaseEvent({ ...context, GITHUB_REF: 'refs/heads/main' }, 'v0.1.0'), /matching release tag/);
  assert.throws(() => assertReleaseEvent({ ...context, GITHUB_ACTIONS: undefined }, 'v0.1.0'), /restricted to GitHub Actions/);
});

test('configuration checks every package version/repository, release flag and finalized notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workcore-release-config-'));
  try {
    for (const folder of packageDirectories) {
      await mkdir(join(directory, 'packages', folder), { recursive: true });
      await writeFile(join(directory, 'packages', folder, 'package.json'), JSON.stringify({ name: `@workcore/${folder}`, version: '0.1.0', publishConfig: { access: 'public' }, repository: { url: 'git+https://github.com/qwacko/workcore.git', directory: `packages/${folder}` } }));
    }
    await writeFile(join(directory, 'CHANGELOG.md'), '## 0.1.0 — Unreleased\n');
    const args = { directory, tag: 'v0.1.0', repository: 'qwacko/workcore' };
    assert.equal((await releaseConfig(args)).distTag, 'latest'); // Verification-only run.
    const event = { action: 'published', release: { tag_name: 'v0.1.0', draft: false, prerelease: false } };
    await assert.rejects(releaseConfig({ ...args, event }), /Finalize the changelog/);
    await writeFile(join(directory, 'CHANGELOG.md'), '## 0.1.0 — 2026-11-08\n');
    assert.equal((await releaseConfig({ ...args, event })).packages.length, 5);
    await assert.rejects(releaseConfig({ ...args, event: { ...event, release: { ...event.release, prerelease: true } } }), /prerelease flag/);
    await assert.rejects(releaseConfig({ ...args, tag: 'v0.1.1' }), /tag\/version mismatch/);
    await assert.rejects(releaseConfig({ ...args, repository: 'another/fork' }), /repository must match/);
    const path = join(directory, 'packages/admin/package.json');
    const original = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...original, private: true }));
    await assert.rejects(releaseConfig(args), /is private/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('packed metadata rejects source exports and unresolved internal versions', () => {
  const config = { version: '0.1.0', repository: 'qwacko/workcore', packages: [pkg] };
  const packed = { name: pkg.name, version: '0.1.0', repository: { url: 'git+https://github.com/qwacko/workcore.git' }, exports: { '.': './dist/index.js' } };
  validatePacked(packed, pkg, config);
  assert.throws(() => validatePacked({ ...packed, exports: './src/index.ts' }, pkg, config), /source/);
  assert.throws(() => validatePacked({ ...packed, dependencies: { '@workcore/core': 'workspace:*' } }, pkg, config), /workspace protocols/);
  assert.throws(() => validatePacked({ ...packed, dependencies: { '@workcore/core': '0.0.9' } }, pkg, config), /release together/);
});

test('registry preflight skips only matching bytes and refuses backwards tags', () => {
  assert.equal(publicationPlan(manifest, [null])[0].skip, false);
  assert.equal(publicationPlan(manifest, [metadata()])[0].skip, true);
  assert.throws(() => publicationPlan(manifest, [metadata(sri('other'))]), /DIFFERENT bytes/);
  assert.throws(() => publicationPlan(manifest, [metadata(pkg.integrity, '0.2.0')]), /backwards/);
  const withoutIntegrity = metadata(); delete withoutIntegrity.versions['0.1.0'].dist.integrity;
  assert.throws(() => publicationPlan(manifest, [withoutIntegrity]), /DIFFERENT bytes/);
});

test('only a registry 404 means missing; network, auth, server and malformed responses fail closed', async () => {
  assert.equal(await registryMetadata(pkg.name, async () => new Response('{}', { status: 404 })), null);
  for (const status of [401, 403, 429, 500, 503]) await assert.rejects(registryMetadata(pkg.name, async () => new Response('{}', { status })), /refusing to assume/);
  await assert.rejects(registryMetadata(pkg.name, async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(registryMetadata(pkg.name, async () => Response.json({ name: pkg.name })), /Invalid registry/);
});

test('preflights the entire release before publishing anything', async () => {
  let published = false;
  const other = { ...pkg, name: '@workcore/client', file: 'workcore-client-0.1.0.tgz' };
  await assert.rejects(publishRelease({ ...manifest, packages: [pkg, other] }, '/unused', {
    request: async url => url.endsWith(encodeURIComponent(other.name)) ? Response.json({ ...metadata(sri('wrong')), name: other.name }) : new Response('{}', { status: 404 }),
    publish: async () => { published = true; },
  }), /DIFFERENT bytes/);
  assert.equal(published, false);
});

test('partial publication can resume without republishing verified versions', async () => {
  const other = { ...pkg, name: '@workcore/client', file: 'workcore-client-0.1.0.tgz', integrity: sri('client') };
  const release = { ...manifest, packages: [pkg, other] };
  const available = new Map([[pkg.name, metadata()]]);
  const calls = [];
  await publishRelease(release, '/artifacts', {
    request: async url => {
      const name = decodeURIComponent(url.split('/').at(-1));
      return available.has(name) ? Response.json(available.get(name)) : new Response('{}', { status: 404 });
    },
    publish: async path => {
      calls.push(path);
      available.set(other.name, { ...metadata(other.integrity), name: other.name });
    },
  });
  assert.deepEqual(calls, ['/artifacts/workcore-client-0.1.0.tgz']);
});

test('artifact verification rejects changed checksums and traversal before running tar or npm', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workcore-release-artifact-'));
  try {
    const config = { tag: 'v0.1.0', version: '0.1.0', distTag: 'latest', repository: 'qwacko/workcore', packages: [pkg] };
    const saved = { ...config, format: 1, commit: 'abc', packages: [pkg] };
    await writeFile(join(directory, 'release-manifest.json'), JSON.stringify(saved));
    await writeFile(join(directory, pkg.file), 'tampered');
    await assert.rejects(verifyArtifacts(config, directory, 'abc'), /integrity mismatch/);
    await writeFile(join(directory, 'release-manifest.json'), JSON.stringify({ ...saved, packages: [{ ...pkg, file: '../outside.tgz' }] }));
    await assert.rejects(verifyArtifacts(config, directory, 'abc'));
    await assert.rejects(verifyArtifacts(config, directory, 'different-commit'), /commit mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
