import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://MJK-One.github.io',
  integrations: [mdx()],
});
