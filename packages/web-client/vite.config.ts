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
        name: 'Pocket-T Workspace',
        short_name: 'Pocket-T',
        description: 'Your Mac workspaces, live terminals, files and apps — from anywhere.',
        theme_color: '#f8f8fc',
        background_color: '#f8f8fc',
        display: 'standalone',
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
