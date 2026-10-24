import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Workcore',
  description: 'Cloudflare-first live workspace applications',
  base: '/workcore/',
  themeConfig: {
    nav: [{ text: 'Guide', link: '/authoring' }, { text: 'GitHub', link: 'https://github.com/qwacko/workcore' }],
    sidebar: [
      { text: 'Introduction', link: '/' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Authoring and migrations', link: '/authoring' },
      { text: 'Live views and large datasets', link: '/sync' },
      { text: 'Tasks, schedules and agents', link: '/execution' },
      { text: 'Security and limits', link: '/security' },
    ],
  },
});
