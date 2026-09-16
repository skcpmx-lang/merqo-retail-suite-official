import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    hookTimeout: 30_000,
    testTimeout: 30_000,
    pool: 'forks'
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../src/core'),
      '@shared': resolve(__dirname, '../src/shared')
    }
  }
})
