import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    lang: z.enum(['en', 'ja']).default('en'),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    image: z.string(),
    lang: z.enum(['en', 'ja']).default('en'),
    order: z.number().optional(),
    inProgress: z.boolean().optional(),
    /** Stack / concept chips shown on the project card (see utils/projectTags.ts for colors). */
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog, projects };

