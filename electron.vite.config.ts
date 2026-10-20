import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [react()],
    build: {
      minify: 'esbuild',
      assetsInlineLimit(filePath: string) {
        // CSP restricts font-src to 'self'; font files must stay separate
        // assets instead of being inlined as data: URIs. Other assets keep
        // Vite's default size-based inlining.
        return /\.(woff2?|ttf|otf)$/i.test(filePath) ? false : undefined
      }
    }
  }
})
