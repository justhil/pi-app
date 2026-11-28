import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { canvasOfflineAssetsPlugin } from './src/main/canvas/offline-assets-plugin'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@earendil-works/pi-ai'] }), canvasOfflineAssetsPlugin(__dirname)],
    resolve: {
      alias: {
        '@shared': resolve('packages/shared'),
      },
    },
    build: {
      rollupOptions: {
        external: [
          'electron',
          '@earendil-works/pi-ai',
          '@earendil-works/pi-coding-agent',
          'better-sqlite3',
        ],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          worker: resolve(__dirname, 'src/worker/index.ts'),
          preview: resolve(__dirname, 'src/preview/index.ts'),
          'preview-wsl': resolve(__dirname, 'src/preview/wsl.ts'),
        },
        output: {
          entryFileNames: (chunk) => {
            return chunk.name === 'worker' || chunk.name === 'preview' || chunk.name === 'preview-wsl'
              ? '[name].mjs'
              : '[name].js'
          },
          format: 'es',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('packages/shared'),
      },
    },
    build: {
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          notification: resolve(__dirname, 'src/preload/notification.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('packages/shared'),
        '@extension-compat': resolve('src/extension-compat'),
      },
    },
    plugins: [react()],
    build: {
      modulePreload: {
        resolveDependencies(filename, deps) {
          if (filename.startsWith('assets/index-')) {
            return deps.filter((dep) => !dep.startsWith('assets/shiki-'))
          }
          return deps
        },
      },
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: {
          manualChunks(id) {
            // Grammars and themes stay in their own chunks so shiki-highlighter's per-language
            // dynamic imports load on demand instead of pulling every grammar at once.
            if (/(?:@shikijs|shiki\/dist)\/(?:langs|themes)\//.test(id)) return undefined
            if (id.includes('node_modules/shiki') || id.includes('@shikijs')) return 'shiki'
            if (id.includes('node_modules/react-dom')) return 'react-dom'
            if (id.includes('node_modules/react/')) return 'react'
          },
        },
      },
    },
  },
})
