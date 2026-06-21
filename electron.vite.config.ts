import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@earendil-works/pi-ai'] })],
    resolve: {
      alias: {
        '@shared': resolve('packages/shared'),
      },
    },
    build: {
      rollupOptions: {
        external: [
          '@earendil-works/pi-ai',
          '@earendil-works/pi-coding-agent',
          'better-sqlite3',
        ],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          worker: resolve(__dirname, 'src/worker/index.ts'),
        },
        output: {
          entryFileNames: (chunk) => {
            return chunk.name === 'worker' ? '[name].mjs' : '[name].js'
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
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
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
            if (id.includes('node_modules/shiki') || id.includes('@shikijs')) return 'shiki'
            if (id.includes('node_modules/react-dom')) return 'react-dom'
            if (id.includes('node_modules/react/')) return 'react'
          },
        },
      },
    },
  },
})
