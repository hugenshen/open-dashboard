import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const helpSrc = join(rootDir, '../docs/user-manual')
const helpDest = join(rootDir, 'public/help')

/** Sync docs/user-manual → public/help so /help/ ships with the SPA. */
function syncUserManual(): Plugin {
  const sync = () => {
    if (!existsSync(join(helpSrc, 'index.html'))) {
      console.warn('[sync-help] docs/user-manual/index.html missing; skip')
      return
    }
    rmSync(helpDest, { recursive: true, force: true })
    mkdirSync(helpDest, { recursive: true })
    cpSync(join(helpSrc, 'index.html'), join(helpDest, 'index.html'))
    const shots = join(helpSrc, 'screenshots')
    if (existsSync(shots)) {
      cpSync(shots, join(helpDest, 'screenshots'), { recursive: true })
    }
  }
  return {
    name: 'sync-user-manual',
    buildStart() {
      sync()
    },
    configureServer(server) {
      sync()
      // Vite SPA fallback 会把 /help/ 当成前端路由，返回空壳；先改写到静态手册。
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (path === '/help' || path === '/help/') {
          const qs = req.url?.includes('?') ? '?' + req.url.split('?')[1] : ''
          req.url = '/help/index.html' + qs
        }
        next()
      })
      server.watcher.add(join(helpSrc, 'index.html'))
      const shots = join(helpSrc, 'screenshots')
      if (existsSync(shots)) server.watcher.add(shots)
      server.watcher.on('change', (file) => {
        if (file.startsWith(helpSrc)) sync()
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), syncUserManual()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.OD_API_PROXY || 'http://127.0.0.1:8082',
        changeOrigin: true
      },
      // Pi harness: FE talks to Agent runtime directly (not via Java conversation runs)
      '/harness': {
        target: process.env.OD_HARNESS_PROXY || 'http://127.0.0.1:8091',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        rewrite: (path) => path.replace(/^\/harness/, ''),
        configure(proxy) {
          proxy.on('proxyRes', (proxyRes, req) => {
            const type = String(proxyRes.headers['content-type'] || '')
            if ((req.url || '').includes('/runs') && type.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        }
      }
    }
  }
})
