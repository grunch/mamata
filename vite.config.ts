/// <reference types="vitest/config" />
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// En desarrollo, si existe seed-out/data (npm run seed), /data/* se sirve desde ahí.
// Nunca se usa en el build: lo publicado es siempre public/data/.
function seedData(): Plugin {
  const seedDir = resolve(import.meta.dirname, 'seed-out')
  return {
    name: 'mamata-seed-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (!path.startsWith('/data/') || path.includes('..')) return next()
        const file = resolve(seedDir, `.${path}`)
        if (!file.startsWith(seedDir) || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
  }
}

// Content-Security-Policy (GitHub Pages no permite headers, va como <meta>).
// Solo en el build: en desarrollo Vite inyecta estilos y scripts que la política bloquearía.
// La app solo habla con su origen; el panel además con la API de GitHub.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'mamata-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const connect = ctx.path.startsWith('/admin') ? "'self' https://api.github.com" : "'self'"
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
    seedData(),
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
        // El panel admin no se cachea para navegación: siempre necesita internet.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/admin/],
        runtimeCaching: [
          {
            // data.enc: con internet trae siempre lo último (así un link nuevo funciona
            // al instante); sin internet, usa lo guardado.
            urlPattern: ({ url }) => url.pathname === '/data/data.enc',
            handler: 'NetworkFirst',
            options: { cacheName: 'mamata-contenido', networkTimeoutSeconds: 5 },
          },
          {
            // Imágenes: nunca cambian para un mismo id. Muestra lo guardado y actualiza en segundo plano.
            urlPattern: ({ url }) => url.pathname.startsWith('/data/img/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'mamata-imagenes', expiration: { maxEntries: 200 } },
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
