import { defineConfig } from 'vite'

// The embeddable widget: one small, dependency-free script (dist/widget.js).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    lib: {
      entry: 'widget/src/index.ts',
      name: 'BotDeskWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
})
