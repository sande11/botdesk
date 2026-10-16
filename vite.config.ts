/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { build, defineConfig, type Plugin } from 'vite'

/** Dev only: serve a fresh build of the embeddable widget at /widget.js. */
function widgetDev(): Plugin {
  return {
    name: 'botdesk-widget-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/widget.js', async (_req, res) => {
        try {
          const out = await build({ configFile: 'vite.widget.config.ts', logLevel: 'silent', build: { write: false, sourcemap: 'inline' } })
          const chunk = (Array.isArray(out) ? out[0] : out as { output: { code?: string }[] }).output[0]
          res.setHeader('content-type', 'text/javascript; charset=utf-8')
          res.setHeader('access-control-allow-origin', '*')
          res.end(chunk.code ?? '')
        } catch (err) {
          res.statusCode = 500
          res.end(`/* widget build failed: ${(err as Error).message} */`)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), widgetDev()],
  resolve: { alias: { '@': '/src' } },
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks cache well across deploys.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'ui', test: /node_modules[\\/](@radix-ui|@floating-ui|sonner|lucide-react|@tanstack)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'widget/**/*.test.ts'],
  },
})
