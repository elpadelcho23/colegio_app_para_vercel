import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import { VitePWA } from 'vite-plugin-pwa';
import { generateSW } from 'workbox-build';
import { fileURLToPath } from 'node:url';

const astroPrerenderEntry = fileURLToPath(
  new URL('./node_modules/astro/dist/entrypoints/prerender.js', import.meta.url),
);
const ariaQueryStub = fileURLToPath(new URL('./src/server/stubs/aria-query.js', import.meta.url));
const axobjectQueryStub = fileURLToPath(new URL('./src/server/stubs/axobject-query.js', import.meta.url));

const pwaManifest = {
  name: 'Aula Clara - Gestión Docente',
  short_name: 'Aula Clara',
  description: 'Asistencia, calificaciones y actividades escolares para docentes.',
  theme_color: '#226c5f',
  background_color: '#f6f7f3',
  display: 'standalone',
  lang: 'es',
  start_url: '/',
  orientation: 'portrait-primary',
  icons: [
    {
      src: 'pwa-icon.svg',
      sizes: '512x512',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: 'pwa-icon.svg',
      sizes: '512x512',
      type: 'image/svg+xml',
      purpose: 'maskable',
    },
  ],
};

const pwaRuntimeCaching = [
  {
    urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'google-fonts-cache',
      expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
  {
    urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'gstatic-fonts-cache',
      expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
];

function aulaClaraPwaIntegration() {
  return {
    name: 'aula-clara-pwa-sw',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const clientDir = fileURLToPath(dir);
        const swDest = fileURLToPath(new URL('./sw.js', dir));

        const { count, size, warnings } = await generateSW({
          swDest,
          globDirectory: clientDir,
          globPatterns: ['**/*.{js,css,svg,webmanifest}'],
          skipWaiting: true,
          clientsClaim: true,
          navigateFallback: null,
          runtimeCaching: pwaRuntimeCaching,
        });

        warnings.forEach((warning) => logger.warn(String(warning)));
        logger.info(`PWA: sw.js generado con ${count} archivos (${size} bytes).`);
      },
    },
  };
}

export default defineConfig({
  output: 'server',
  devToolbar: {
    enabled: false,
  },
  adapter: vercel(),
  integrations: [aulaClaraPwaIntegration()],
  vite: {
    plugins: [
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'pwa-icon.svg'],
        manifest: pwaManifest,
        injectRegister: false,
        workbox: {
          navigateFallback: null,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
          runtimeCaching: pwaRuntimeCaching,
        },
        devOptions: {
          enabled: true,
        },
      }),
    ],
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
