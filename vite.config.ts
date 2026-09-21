import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: run `npm run server` on :8787 for real OAuth + API.
// Vite mock plugin removed so /api and /oauth proxy to Node.
export default defineConfig({
  plugins: [react()],
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
})
