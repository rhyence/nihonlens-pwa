import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { packCache } from './src/pack-info';

export default defineConfig({
  worker: { format: 'es' },
  plugins: [VitePWA({
    registerType: 'prompt',
    manifest: {
      name: 'NihonLens', short_name: 'NihonLens', start_url: '/',
      display: 'standalone', theme_color: '#101820', background_color: '#101820',
      icons: [192, 512].map(size => ({ src: '/icon-' + size + '.png', sizes: size + 'x' + size, type: 'image/png' })),
    },
    workbox: { clientsClaim: true, runtimeCaching: [{ urlPattern: /\/__pack\//, handler: 'CacheOnly', options: { cacheName: packCache } }], globPatterns: ['**/*.{html,css,js,png,webmanifest}'], globIgnores: ['runtime/**'], navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/__pack\//, /^\/runtime\//] },
  })],
});
