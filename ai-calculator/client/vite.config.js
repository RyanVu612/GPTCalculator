// vite.config.ts (or .js)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    server: {
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: true, secure: false }
      }
    },
  },
})
