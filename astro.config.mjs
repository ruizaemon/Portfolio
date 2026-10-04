// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  // Vue islands power the interactive tools (src/components/tools)
  integrations: [vue()],
  // $…$ and $$…$$ in markdown become typeset math at build time (KaTeX, no client JS).
  // These plugins need @astrojs/markdown-remark, Astro's unified-based markdown processor
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
  i18n: {
    locales: ['en', 'ja'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false, // root redirect handled by pages/index.astro
    },
  },
  vite: {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  },
});
