import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { fileURLToPath } from 'node:url';

const astroPrerenderEntry = fileURLToPath(
  new URL('./node_modules/astro/dist/entrypoints/prerender.js', import.meta.url),
);
const ariaQueryStub = fileURLToPath(new URL('./src/server/stubs/aria-query.js', import.meta.url));
const axobjectQueryStub = fileURLToPath(new URL('./src/server/stubs/axobject-query.js', import.meta.url));

export default defineConfig({
  output: 'server',
  devToolbar: {
    enabled: false,
  },
  adapter: node({
    mode: 'standalone',
  }),
  vite: {
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
    resolve: {
      alias: {
        'astro/entrypoints/prerender': astroPrerenderEntry,
        'aria-query': ariaQueryStub,
        'axobject-query': axobjectQueryStub,
      },
    },
  },
});
