import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Root TypeScript 7 exposes the native compiler, not the JavaScript AST API.
// The example already declares TypeScript 6 for its Svelte tooling; reuse that
// parser for syntax-only public-surface discovery, never for app typechecking.
const ts = createRequire(new URL('../examples/workcore-demo/package.json', import.meta.url))('typescript');

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = join(root, 'docs');
const reference = await readFile(join(docs, 'reference.md'), 'utf8');
const codeSpans = [...reference.matchAll(/`([^`\n]+)`/g)].map(match => match[1]);
const syntax = (text, filename = 'entry.ts') => ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const exported = node => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);

function runtimeExports(text) {
  const names = [];
  for (const node of syntax(text).statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) continue;
      assert(node.exportClause && ts.isNamedExports(node.exportClause), 'Expand runtime wildcard exports explicitly so documentation can track the public surface');
      for (const entry of node.exportClause.elements) if (!entry.isTypeOnly) names.push(entry.name.text);
    } else if (exported(node)) {
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) names.push(node.name.text);
      else if (ts.isVariableStatement(node)) {
        for (const entry of node.declarationList.declarations) {
          assert(ts.isIdentifier(entry.name), 'Document exported destructured bindings explicitly');
          names.push(entry.name.text);
        }
      }
    }
  }
  return names;
}

test('documentation export discovery tracks aliases and excludes type-only declarations', () => {
  assert.deepEqual(runtimeExports(`
    export type Actor = { id: string };
    export interface Options { enabled: boolean }
    export type { Definition } from './definitions';
    export { type Json, encode as encodeJson } from './json';
    export const limit = 10;
    export function create() {}
    export class Client {}
  `), ['encodeJson', 'limit', 'create', 'Client']);
  assert.throws(() => runtimeExports("export * from './other';"), /wildcard/);
});

test('every public package runtime export has a code-named entry in the API index', async () => {
  let count = 0;
  for (const folder of await readdir(join(root, 'packages'))) {
    const directory = join(root, 'packages', folder);
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    for (const [entry, source] of Object.entries(metadata.exports)) {
      assert.equal(typeof source, 'string', 'Extend documentation discovery for new conditional export shapes');
      const names = runtimeExports(await readFile(join(directory, source), 'utf8'));
      assert(names.length > 0, `${metadata.name}/${entry}: no runtime exports discovered`);
      for (const name of names) {
        const pattern = new RegExp(`\\b${name}\\b`);
        assert(codeSpans.some(span => pattern.test(span)), `${metadata.name} ${entry}: document ${name} in docs/reference.md and link its detailed contract`);
        count++;
      }
    }
  }
  assert(count > 30, 'Expected the complete public runtime export surface');
});

test('client and workspace factory methods are covered by their references', async () => {
  const cases = [
    ['packages/client/src/index.ts', 'createClient', await readFile(join(docs, 'client-api.md'), 'utf8')],
    ['packages/core/src/definitions.ts', 'workspace', reference],
  ];
  for (const [path, functionName, markdown] of cases) {
    const source = syntax(await readFile(join(root, path), 'utf8'));
    const factory = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === functionName);
    const returned = factory.body.statements.find(node => ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression));
    assert(returned, `Find the public ${functionName} method map`);
    for (const member of returned.expression.properties) {
      assert(member.name && ts.isIdentifier(member.name), 'Extend method discovery for new public property shapes');
      const name = member.name.text;
      if (name !== 'files') assert(markdown.includes(`${name}(`) || markdown.includes(`.${name}\``), `${functionName}.${name}: add method documentation`);
      if (name === 'files' && ts.isPropertyAssignment(member) && ts.isObjectLiteralExpression(member.initializer)) {
        for (const method of member.initializer.properties) assert(markdown.includes(`files.${method.name.text}(`), `Document files.${method.name.text}`);
      }
    }
  }
});

test('UI builders and nested helpers are covered by the admin reference', async () => {
  const source = syntax(await readFile(join(root, 'packages/core/src/ui.ts'), 'utf8'));
  const admin = await readFile(join(docs, 'admin.md'), 'utf8');
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => ts.isIdentifier(node.name) && node.name.text === 'ui');
  assert(declaration && ts.isObjectLiteralExpression(declaration.initializer));
  function check(object) {
    for (const member of object.properties) {
      if (ts.isPropertyAssignment(member) && ts.isObjectLiteralExpression(member.initializer)) check(member.initializer);
      else {
        assert(member.name && ts.isIdentifier(member.name));
        assert(admin.includes(`${member.name.text}(`), `Document ui helper ${member.name.text}`);
      }
    }
  }
  check(declaration.initializer);
});

test('every top-level documentation page is discoverable in the sidebar', async () => {
  const config = await readFile(join(docs, '.vitepress/config.ts'), 'utf8');
  const routes = new Set([...config.matchAll(/link:\s*'([^']+)'/g)].map(match => match[1]));
  for (const name of await readdir(docs)) {
    if (name.endsWith('.md')) assert(routes.has(name === 'index.md' ? '/' : `/${name.slice(0, -3)}`), `Add ${name} to the appropriate sidebar group`);
  }
});

test('local Markdown links resolve to existing pages or files', async () => {
  const paths = ['README.md', 'AGENTS.md', 'packages/core/AGENTS.example.md'];
  for (const name of await readdir(docs)) if (name.endsWith('.md')) paths.push(`docs/${name}`);
  for (const path of paths) {
    const content = (await readFile(join(root, path), 'utf8')).replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
    for (const match of content.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
      const href = match[1].split('#')[0];
      if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) continue;
      let target = href.startsWith('/') ? join(docs, href.slice(1)) : resolve(root, dirname(path), href);
      if (target.endsWith('.html')) target = target.slice(0, -5) + '.md';
      if (!extname(target)) target += '.md';
      assert(await stat(target).then(() => true, () => false), `${path}: broken local link ${match[1]}`);
    }
  }
});
