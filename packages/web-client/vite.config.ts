import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Build emits static files to packages/web-client/dist — exactly what the
// daemon serves for the pocket-t web UI. See README.md for the serve route.
export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      // Custom service worker (src/sw.ts) so we can add Web Push handlers;
      // vite-plugin-pwa injects the precache manifest into it.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false, // main.ts registers via virtual:pwa-register
      manifest: {
        name: 'pocket-t',
        short_name: 'pocket-t',
        description: 'Mirror your Mac terminal + CLI agents to your phone.',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
});
