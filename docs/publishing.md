# Publishing the initial packages

The five packages are prepared as `0.1.0` public ESM packages. They are not published just because they build or have a version in `package.json`. Nothing in the development/test commands publishes to npm or deploys to Cloudflare.

The existing todo/notes example is our release reference application. Deploy that Worker to validate the app, and publish the libraries so you can install them in your other apps. A separately designed example application is not a prerequisite. The root workspace and example stay private; there is no umbrella `workcore` npm package.

Local workspace exports intentionally point to TypeScript sources for development. **Use pnpm to pack**: each package's `publishConfig.exports` replaces those paths with compiled JavaScript and declaration exports in the tarball. `workspace:*` dependencies become the matching package versions. The release workflow then uses npm to publish those already-transformed tarballs, because npm handles trusted publishing. Do not use `npm publish` directly against source package directories.

Run before release:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm docs:build
node scripts/package-smoke.mjs
```

`pnpm test:packages` is a standalone build-and-pack check. It extracts all five tarballs into a private temporary directory, uses the installed third-party dependencies without a registry fetch, and verifies:

- Node imports, typed mutation inference and prebuilt admin asset copying.
- The packaged `AGENTS.example.md` consumer guide.
- The README/getting-started code: schema generation, migration ingestion, typechecking and a Worker deployment **dry run**.
- A temporary copy of the **existing example app**, built with the packed library exports instead of workspace TypeScript source, followed by its Wrangler deployment **dry run**. Only source/config inputs are copied, not local secrets or persisted data.

The check also rejects published manifests that reference source files or workspace protocols. CI runs it after building. This validates packaging and the existing application without publishing or deploying; it is not proof of a fresh registry install or real Cloudflare behavior.

The admin package includes its prebuilt `/admin` SPA and a build-time helper:

```js
import { copyAdminAssets } from '@workcore/admin/assets';
await copyAdminAssets(new URL('./public/admin-assets/', import.meta.url));
```

Serve those files through the host's asset binding and `serveAdmin` from `@workcore/admin/server`, using the routing pattern in the demo Worker. The asset helper is Node-only build tooling, not a Worker runtime import.

## GitHub Actions release workflow

`.github/workflows/release.yml` provides two entry points:

- **Publish a GitHub Release:** checks out its exact `vX.Y.Z` tag, verifies every package version and repository field, requires finalized changelog notes, runs all checks, packs the five libraries, and attaches their tarballs and `release-manifest.json` to that GitHub Release. It publishes to npm **only if** repository variable `NPM_PUBLISH_ENABLED` is exactly `true`.
- **Actions → Release packages → Run workflow:** takes an existing tag and verifies/packs it only. It never publishes to npm or modifies a GitHub Release, even when npm publication is enabled. Download its `npm-release` Actions artifact to inspect the result.

The workflow uses GitHub-hosted Ubuntu runners, Node 24, pinned actions, and npm 11.21.0. Only the publish job can request an OIDC token; only the release-asset job can write GitHub contents. The publish job installs no project dependencies and does not rebuild anything: it consumes exactly the verified artifact. Releases are serialized and a running publication is never automatically canceled.

### Do I need Cloudflare automatic deployment first?

No. A manually validated deployment of the existing example is enough for the first release. Follow its README, check authentication, private/shared todos, private notes, cross-tab updates, files and a scheduled job on the real Cloudflare deployment. This is valuable evidence that local tests/dry runs cannot replace.

Keep Cloudflare app deployment separate from npm publication. This workflow has no Cloudflare credentials and does not deploy remotely. Add a separate, protected example-deployment workflow later if it saves you time; it is not a prerequisite for publishing the libraries.

## One-time setup

1. **Confirm the npm scope and repository.** The packages currently use `@workcore/*` and repository `qwacko/workcore`. You must control that npm scope and be allowed to publish its public packages. If either changes, update all package names/dependencies/imports/docs and `repository` metadata before tagging. Trusted publishing checks the repository metadata against the real GitHub repository; a fork must update those fields.
2. **Commit/push the workflow and release changes.** The workflow must be present in the tagged commit. It must also be on the default branch to appear in the manual Actions UI. Protect the main branch and release tags (`v*`) against unauthorized changes; do not move/reuse published tags.
3. **Create a GitHub environment named `npm-release`.** In repository Settings → Environments, optionally require approval before publication and restrict deployment tags to `v*`. If you are the only maintainer, do not configure approval rules that prevent you from approving your own release. GitHub plan/repository visibility can affect available protections.
4. **Leave automatic npm publishing disabled initially.** Do not create `NPM_PUBLISH_ENABLED`, or set it to `false`, under Settings → Secrets and variables → Actions → Variables. The workflow can still verify and attach release assets. No npm token or Cloudflare secret is needed for this stage.
5. **Bootstrap the npm packages once if they do not yet exist**, using the first-release instructions below. npm's package-settings trusted-publisher setup requires existing packages. Do not create a dummy version that you intend to overwrite later; use the actual verified first-release artifacts.
6. **Configure a trusted publisher for each of the five packages** on npmjs.com → package → Settings → Trusted publishing. Select GitHub Actions and enter:
   - Organization/user: `qwacko` (or the actual owner).
   - Repository: `workcore` (or the actual repository).
   - Workflow filename: **`release.yml`**, not its full path.
   - Environment name: **`npm-release`**.
   - Allowed actions: enable **direct `npm publish`**. Stage-only permission is not sufficient for this workflow. It does not need dist-tag management permission, because it does not separately modify existing dist-tags.
7. **Enable future automated publishes.** Set repository variable `NPM_PUBLISH_ENABLED=true` only after all five publisher configurations are ready. Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN`; this workflow explicitly uses OIDC instead. npm currently requires a new trusted publisher to complete a successful publication within two days of configuration, so configure it when ready for the next release. After confirming it works, consider npm's “Require two-factor authentication and disallow tokens” setting.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) for current requirements. Public repositories/public packages receive automatic npm provenance via OIDC. Private source repositories do not get provenance; the workflow disables it for that case. A local `npm whoami` is not a test of the workflow's OIDC authorization.

## First release / npm bootstrap

These instructions assume version **0.1.0** has not been published and automatic npm publishing is still disabled.

1. Validate the example on Cloudflare manually. Review the release changes and replace `Unreleased` in the `0.1.0` changelog heading with the actual release date. Commit and push the reviewed state. All five package versions must be `0.1.0`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag -a v0.1.0 -m 'Workcore 0.1.0'
   git push origin v0.1.0
   ```

3. Optionally run the workflow manually for `v0.1.0` to inspect verification results. Then create a **draft GitHub Release** using that existing tag, add the changelog notes, and publish it when ready. For stable `0.1.0`, leave “Set as a pre-release” unchecked. Drafts do not trigger publication.
4. Wait for **Verify and pack** and **Attach verified packages** to pass. The npm job should show **skipped** because the variable is disabled. Download the five attached tarballs and `release-manifest.json` from that GitHub Release. A published GitHub Release does not itself mean the npm packages are available.
5. Authenticate in your own terminal, inspect the artifacts, and publish those **exact downloaded tarballs** in dependency order. These commands make the public npm packages available:

   ```sh
   npm login --scope=@workcore --registry=https://registry.npmjs.org
   npm whoami --registry=https://registry.npmjs.org
   npm publish ./workcore-core-0.1.0.tgz --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org
   npm publish ./workcore-client-0.1.0.tgz --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org
   npm publish ./workcore-files-0.1.0.tgz --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org
   npm publish ./workcore-ai-0.1.0.tgz --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org
   npm publish ./workcore-admin-0.1.0.tgz --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org
   ```

   Complete npm's interactive authorization/2FA as required. Never put tokens/one-time passwords in chat or committed files. Manual bootstrap does not generate GitHub OIDC provenance; subsequent automated releases do. If publication is partial, inspect npm and finish only the missing packages using the original artifacts—do not rebuild or overwrite a version.
6. Verify the five registry versions and install into your intended consuming application. For example:

   ```sh
   pnpm view @workcore/core@0.1.0 version --registry=https://registry.npmjs.org
   pnpm add @workcore/core@0.1.0 @workcore/client@0.1.0 drizzle-orm@^0.45.4 zod@^4.6.7
   ```

7. Configure the five npm trusted publishers and enable the GitHub repository variable as above. Use the next coordinated release (for example `0.1.1`) to exercise automated publication. Do not attempt to republish `0.1.0` from newly built tarballs.

## Subsequent releases

Update all five versions together, add/finalize the corresponding changelog heading, commit, tag (`v0.1.1`), and publish a GitHub Release from that tag. The workflow attaches checked artifacts and then waits for any configured `npm-release` approval before publishing them. `NPM_PUBLISH_ENABLED` must be `true`.

For a prerelease, use coordinated versions such as `0.2.0-rc.1`, tag `v0.2.0-rc.1`, and mark the GitHub Release as a prerelease. The workflow validates the flag/version relationship and publishes to `next`; stable releases use `latest`. Supported tags have no SemVer build metadata.

## Failure and retry rules

- Five npm publishes are **not atomic**. The script checks every package before making any publication. Only a registry 404 means “not present”; authentication, rate-limit, network and server errors fail closed.
- A version already on npm is skipped only when its SHA-512 integrity matches the verified tarball. Missing integrity or different bytes aborts the release. The script never unpublishes, overwrites a version, or silently assumes an arbitrary existing version is correct.
- A missing version cannot be published in a way that moves `latest`/`next` backwards. Skipping an existing matching version does not retag it.
- Use GitHub's **Re-run failed jobs** after a partial publication, not **Re-run all jobs**. This reuses the original `npm-release` artifact (retained for 90 days), rather than rebuilding packages that may contain generated timestamps/build IDs. Resolve npm permission/configuration errors before approving/rerunning.
- GitHub release assets are compared before upload and are never silently replaced with different bytes. If the wrong release artifact/tag was used, stop and resolve it explicitly; normally issue a new patch version rather than trying to repair an immutable npm version.
- A registry propagation delay after publish can fail the verification step. Inspect npm and rerun the failed job with the same artifact after it is visible; do not rebuild/retry under a different version blindly.
- If assets exist but npm publication was skipped, check the repository variable and event type. A manual workflow run intentionally never publishes. If OIDC fails, check the exact owner/repository, `release.yml` filename, `npm-release` environment and direct-publish permission for **each** npm package.

For local inspection after building, `node scripts/release.mjs check --tag v0.1.0` validates release metadata without publishing. `node scripts/release.mjs pack --tag v0.1.0 --directory /path/to/empty/output` writes tarballs plus an integrity manifest; use an empty directory rather than overwriting previous artifacts. `verify` with the same options checks artifacts against the current commit. The `publish` and `attach` commands are restricted to the matching GitHub release event.
