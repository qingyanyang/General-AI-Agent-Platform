// PROTOTYPE (#52): standalone Vite app for the Agent Management redesign.
// Run from frontend/: npx vite --config prototypes/agent-management/vite.config.ts
// Mock data only. It never calls the platform API and is not part of the production build.
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
})
