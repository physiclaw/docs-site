import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// `scripts/sync-docs.mjs` writes the split locale content into Starlight's
// default location (`src/content/docs/{en,zh}`), so the stock docsLoader()
// reads it and sidebar `autogenerate` works.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
