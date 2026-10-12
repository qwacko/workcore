import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(root, 'docs');
const corePackage = JSON.parse(await readFile(resolve(root, 'packages/core/package.json'), 'utf8'));
const version = process.argv[2] ?? corePackage.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid documentation version '${version}'`);

const destination = resolve(source, 'versions', version);
let alreadyExists = false;
try { await access(destination); alreadyExists = true; }
catch {}

if (alreadyExists) {
  console.log(`Documentation snapshot ${version} already exists; leaving it unchanged.`);
} else {
  async function copyDocs(from, to) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'versions') continue;
      const sourcePath = resolve(from, entry.name);
      const targetPath = resolve(to, entry.name);
      if (entry.isDirectory()) await copyDocs(sourcePath, targetPath);
      else if (entry.isFile()) await cp(sourcePath, targetPath);
    }
  }
  await copyDocs(source, destination);
  async function rewriteMarkdownLinks(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await rewriteMarkdownLinks(path);
      else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md') {
        const markdown = await readFile(path, 'utf8');
        await writeFile(path, markdown.replace(/\]\(\/(?!\/)/g, `](/versions/${version}/`));
      }
    }
  }
  await rewriteMarkdownLinks(destination);
  const archivedIndex = `# Workcore v${version}\n\nThis is the documentation snapshot for the Workcore core release **${version}**. It is kept as published; see the [latest documentation](/) for current guidance.\n\n## Pages\n\n- [Getting started](./getting-started)\n- [Authoring](./authoring)\n- [Architecture and security](./architecture)\n- [Production deployment](./production-deployment)\n`;
  await writeFile(resolve(destination, 'index.md'), archivedIndex);
  console.log(`Created docs/versions/${version} from the current documentation.`);
}
