import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mockApiPlugin } from './src/mocks/vitePlugin'

export default defineConfig({
  plugins: [react(), mockApiPlugin()],
  server: { port: 5173 },
  preview: { port: 4173 },
})
