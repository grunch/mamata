/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { BLOSSOM_SERVERS, RELAYS } from './src/shared/nostr/constants.ts'

// Content-Security-Policy (GitHub Pages no permite headers, va como <meta>).
// Solo en el build: en desarrollo Vite inyecta estilos y scripts que la política bloquearía.
// La app y el panel solo hablan con su origen, los relays y los servidores Blossom.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'mamata-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const connect = ["'self'", ...RELAYS, ...BLOSSOM_SERVERS].join(' ')
        const policy = [
          "default-src 'none'",
          "script-src 'self'",
          "style-src 'self'",
          "img-src 'self' blob: data:",
          `connect-src ${connect}`,
          "manifest-src 'self'",
          "worker-src 'self'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ')
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
      },
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Mamata',
        short_name: 'Mamata',
        description: 'Mensajes, recordatorios y tarjetas de regalo.',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fffdf8',
        theme_color: '#1f3f6e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Shell de la app precacheado: abre sin internet.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // El panel no se cachea: necesita internet igual y tiene que cargar siempre la
        // última versión (una copia vieja publicaría con lógica vieja).
        globIgnores: ['admin/**', 'assets/admin-*'],
        // El panel admin no se cachea para navegación: siempre necesita internet.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/admin/],
        runtimeCaching: [
          {
            // Imágenes de Blossom: se piden por SHA-256, así que nunca cambian.
            urlPattern: ({ url }) => BLOSSOM_SERVERS.includes(url.origin) && /^\/[0-9a-f]{64}$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mamata-imagenes',
              expiration: { maxEntries: 300 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts (arranque) se prueba con e2e; image.ts necesita canvas real.
      exclude: ['src/**/main.ts', 'src/admin/image.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
