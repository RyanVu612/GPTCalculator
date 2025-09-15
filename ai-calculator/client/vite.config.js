// vite.config.ts (or .js)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001', // your Express server
        changeOrigin: true,
        secure: false, // ignore TLS errors if you ever point to https with a self-signed cert
      },
    },
  },
})
