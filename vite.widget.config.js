import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Separate build config for the embeddable widget bundle
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-widget',
    lib: {
      entry: 'src/widget-entry.jsx',
      name: 'BotDeskWidget',
      fileName: 'widget',
      formats: ['iife'], // Immediately-invoked for easy <script> tag embedding
    },
    rollupOptions: {
      // Bundle React into the widget so it works on any site
      external: [],
    },
  },
})
