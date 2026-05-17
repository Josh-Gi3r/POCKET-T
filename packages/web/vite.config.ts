import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType:     'autoUpdate',
      strategies:       'injectManifest',
      srcDir:           'public',
      filename:         'sw.js',
      injectManifest:   { injectionPoint: undefined },
      manifest: {
        name:             'pocket-t',
        short_name:       'pocket-t',
        description:      'Your terminal sessions in your pocket',
        start_url:        '/',
        scope:            '/',
        display:          'standalone',
        display_override: ['standalone', 'browser'],
        orientation:      'portrait-primary',
        background_color: '#0c0d0f',
        theme_color:      '#0c0d0f',
        lang:             'en',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src:     '/icons/icon-512-maskable.png',
            sizes:   '512x512',
            type:    'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    port:  3000,
    // When served through an HTTPS tunnel (phone testing), allow the
    // tunnel host and route HMR over wss:443. No effect on plain `pnpm dev`.
    allowedHosts: process.env.PUBLIC_HOST ? [process.env.PUBLIC_HOST] : undefined,
    hmr: process.env.PUBLIC_HOST
      ? { host: process.env.PUBLIC_HOST, protocol: 'wss', clientPort: 443 }
      : undefined,
    proxy: {
      '/api':       { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', changeOrigin: true, ws: true },
    },
  },
});
