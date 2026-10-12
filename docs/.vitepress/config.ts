import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitepress';

const versionsPath = resolve(import.meta.dirname, '../versions');
const versions = readdirSync(versionsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
const base = process.env.DOCS_BASE ?? (process.env.GITHUB_ACTIONS === 'true' ? '/workcore/' : '/');

export default defineConfig({
  title: 'Workcore',
  description: 'A typed TypeScript workspace application runtime.',
  base,
  cleanUrls: true,
  themeConfig: {
    siteTitle: 'Workcore',
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Authoring', link: '/authoring' },
      { text: 'Production', link: '/production-deployment' },
      {
        text: 'Versions',
        items: [
          { text: 'Latest', link: '/' },
          ...versions.map((version) => ({ text: `v${version}`, link: `/versions/${version}/` })),
        ],
      },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Authoring', link: '/authoring' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Architecture and security', link: '/architecture' },
          { text: 'Production deployment', link: '/production-deployment' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/qwacko/workcore' }],
    footer: { message: 'Released under the MIT License.', copyright: 'Copyright © Workcore contributors' },
  },
});
