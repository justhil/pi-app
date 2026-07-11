import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/renderer/src/test/setup.ts'],
    include: [
      'src/renderer/src/**/*.test.{ts,tsx}',
      'packages/shared/**/*.test.ts',
      'src/extension-compat/**/*.test.ts',
    ],
    exclude: ['node_modules/**', 'out/**', 'dist/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('packages/shared'),
      '@extension-compat': resolve('src/extension-compat'),
    },
  },
})
