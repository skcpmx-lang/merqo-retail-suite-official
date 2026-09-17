import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve(__dirname, 'src/core'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      lib: { entry: 'src/main/index.ts' },
      outDir: 'out/main',
      rollupOptions: {
        external: ['better-sqlite3', 'electron'],
        output: { format: 'cjs', entryFileNames: 'index.js', inlineDynamicImports: true }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'src/preload/index.ts' },
      outDir: 'out/preload',
      rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'index.js' } }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            query: ['@tanstack/react-query']
          }
        }
      }
    }
  }
})
