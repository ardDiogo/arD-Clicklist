/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'arD ClikList',
        short_name: 'ClikList',
        description: 'Estoque da casa e lista de compras inteligente: o app sabe o que falta.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        background_color: '#fafaf9',
        theme_color: '#fafaf9',
        categories: ['shopping', 'lifestyle', 'productivity'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Atalhos ao segurar o ícone na tela inicial (Android/desktop).
        shortcuts: [
          { name: 'Lista de compras', short_name: 'Lista', url: '/lista', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          { name: 'Registrar compra', short_name: 'Compra', url: '/compras', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          {
            name: 'Conferir despensa por fotos',
            short_name: 'Fotos',
            url: '/inventario?voltar=lista',
            icons: [{ src: 'pwa-192.png', sizes: '192x192' }],
          },
        ],
        // Prévias exibidas na janela de instalação (Android/Chrome).
        screenshots: [
          { src: 'screenshots/inicio-narrow.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Início com o que precisa repor' },
          { src: 'screenshots/lista-narrow.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Lista de compras montada sozinha' },
          { src: 'screenshots/estoque-narrow.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Estoque da casa por ambiente' },
          { src: 'screenshots/inicio-wide.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide', label: 'Início' },
          { src: 'screenshots/lista-wide.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide', label: 'Lista de compras' },
        ],
      },
      workbox: {
        // Somente o "app shell" é cacheado. Dados do Supabase nunca são
        // servidos do cache para evitar estoque/lista desatualizados.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Fontes de alfabetos não usados ficam fora do precache (baixadas só se necessárias).
        globIgnores: ['**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2', 'screenshots/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\//],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
