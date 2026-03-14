/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/v1/ws': {
        target: 'ws://localhost:8001',
        ws: true,
        changeOrigin: true,
      },
      // IoT service WebSocket console (must come before the /iot HTTP catch-all)
      '/iot-ws': {
        target: 'ws://localhost:8020',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/iot-ws/, ''),
      },
      '/iot': {
        target: 'http://localhost:8020',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/iot/, ''),
      },
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
