/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const cpampDir = path.resolve(rootDir, 'src/cpamp')

// Dev: run `npm run server` on :8787 for real OAuth + API.
// Vite mock plugin removed so /api and /oauth proxy to Node.
//
// src/cpamp/** is ported verbatim from cpa-manager-plus (MIT). It keeps its original
// `@/…` import specifiers, so `@` is aliased to src/cpamp (MrBlank code does not use `@`).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    // CPAMP demo-site code paths are compiled out.
    __DEMO_SITE__: JSON.stringify(mode === 'test'),
  },
  resolve: {
    alias: [
      {
        find: /^@\/features\/demo\/demoFixtures$/,
        replacement: path.resolve(cpampDir, 'features/demo/demoFixtures.empty.ts'),
      },
      { find: /^@\//, replacement: `${cpampDir}/` },
    ],
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: '[name]__[local]___[hash:base64:5]',
    },
    preprocessorOptions: {
      scss: {
        // Same injection as CPAMP's vite config, restricted to the ported tree.
        additionalData: (source: string, filename: string) =>
          filename.startsWith(cpampDir) && !/styles\/(variables|mixins)\.scss$/.test(filename)
            ? `@use "@/styles/variables" as *;\n@use "@/styles/mixins" as *;\n${source}`
            : source,
      },
    },
  },
  test: {
    include: ['src/cpamp/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/oauth': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/oauth': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
}))
