// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeFoldSections from './src/utils/rehypeFoldSections.mjs';
import rehypeDiagrams from './src/utils/rehypeDiagrams.mjs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  // Vue islands power the interactive tools (src/components/tools)
  integrations: [vue()],
  // $…$ and $$…$$ in markdown become typeset math at build time (KaTeX, no client JS).
  // These plugins need @astrojs/markdown-remark, Astro's unified-based markdown processor.
  // rehypeDiagrams swaps <div data-diagram> placeholders for inline SVG (src/diagrams);
  // rehypeFoldSections wraps each section of a tool write-up in <details> so headings fold.
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex, rehypeDiagrams, rehypeFoldSections],
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
