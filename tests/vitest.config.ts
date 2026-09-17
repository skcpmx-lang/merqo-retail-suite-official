import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    hookTimeout: 30_000,
    testTimeout: 30_000,
    pool: 'forks'
  },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../src/core'),
      '@shared': resolve(__dirname, '../src/shared'),
      '@': resolve(__dirname, '../src/renderer/src')
    }
  }
})
