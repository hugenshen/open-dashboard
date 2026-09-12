import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import type { ServerResponse } from 'node:http'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const helpSrc = join(rootDir, '../.teamai/docs/user-manual')
const helpDest = join(rootDir, 'public/help')

/** Sync .teamai/docs/user-manual → public/help so /help/ ships with the SPA. */
function syncUserManual(): Plugin {
  const sync = () => {
    if (!existsSync(join(helpSrc, 'index.html'))) {
      console.warn('[sync-help] .teamai/docs/user-manual/index.html missing; skip')
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

/** dsh RPC lives under /api/<method> and collides with Java /api.
 * 0.1.1 used dotted methods (events.mux). 0.1.2 typert also uses slashes (settings/describe).
 * Mux WebSockets (/api/remote.mux, events.*) must NOT match here — Vite's ws proxy owns them. */
function isDshRpcPath(url = '') {
  const path = url.split('?')[0]
  if (
    path === '/api/remote.mux' ||
    path === '/api/events.mux' ||
    path === '/api/events.host' ||
    path.startsWith('/api/remote.mux?') ||
    path.startsWith('/api/events.mux?') ||
    path.startsWith('/api/events.host?')
  ) {
    return false
  }
  if (path.startsWith('/api/events.') || path.startsWith('/api/dynamicCordisRunner')) return true
  if (path === '/api/respond' || path.startsWith('/api/respond?')) return true
  const rest = path.startsWith('/api/') ? path.slice(5) : ''
  if (!rest) return false
  if (/^(commands|credentials|directoryPicker|fileReferences|session|settings|skills|subagents|workspace)(\/|$)/.test(rest)) return true
  return rest.includes('.') && !rest.includes('/')
}

function dshApiSplit(): Plugin {
  const target = new URL(process.env.OD_DSH_PROXY || 'http://127.0.0.1:3090')
  const loopbackOrigin = `http://${target.hostname}:${target.port || '80'}`
  return {
    name: 'dsh-api-split',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Never treat Upgrade as plain HTTP RPC — leave for Vite ws proxy.
        if (String(req.headers.upgrade || '').toLowerCase() === 'websocket') {
          next()
          return
        }
        if (!isDshRpcPath(req.url || '')) {
          next()
          return
        }
        const upstream = httpRequest({
          hostname: target.hostname,
          port: Number(target.port || 80),
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: target.host,
            origin: loopbackOrigin,
            'sec-fetch-site': 'same-origin',
          },
        }, (up) => {
          res.writeHead(up.statusCode || 502, up.headers)
          up.pipe(res)
        })
        upstream.on('error', (err) => {
          if (!(res as ServerResponse).headersSent) (res as ServerResponse).writeHead(502)
          res.end(String(err.message))
        })
        req.pipe(upstream)
      })
    }
  }
}

/** Same-origin /dsh/ iframe talks to this host; rewrite Origin/Host to loopback so dsh's /api trust fence accepts the WS. */
function dshLoopbackProxy() {
  const target = process.env.OD_DSH_PROXY || 'http://127.0.0.1:3090'
  const loopback = new URL(target)
  const host = loopback.host
  const origin = `http://${host}`
  return {
    target,
    changeOrigin: true,
    configure(proxy: { on: (event: string, cb: (...args: any[]) => void) => void }) {
      const rewrite = (proxyReq: { setHeader: (k: string, v: string) => void }) => {
        proxyReq.setHeader('origin', origin)
        proxyReq.setHeader('sec-fetch-site', 'same-origin')
        proxyReq.setHeader('host', host)
      }
      proxy.on('proxyReq', rewrite)
      proxy.on('proxyReqWs', rewrite)
    },
  }
}

/** P017: token exchange 303 Location:/ would leave the iframe on Vue `/`. Keep it under /dsh/. */
function dshEmbedProxy() {
  const base = dshLoopbackProxy()
  return {
    ...base,
    ws: true,
    rewrite: (path: string) => path.replace(/^\/dsh/, ''),
    configure(proxy: { on: (event: string, cb: (...args: any[]) => void) => void }) {
      base.configure(proxy)
      proxy.on('proxyRes', (proxyRes: { headers: Record<string, string | string[] | undefined> }) => {
        const loc = proxyRes.headers.location
        const raw = Array.isArray(loc) ? loc[0] : loc
        if (!raw) return
        try {
          const u = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw, 'http://127.0.0.1')
          if (u.pathname === '/' || u.pathname === '') {
            proxyRes.headers.location = '/dsh/' + (u.search || '')
          }
        } catch {
          /* keep upstream location */
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), syncUserManual(), dshApiSplit()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // 0.1.2 Gateway remote event stream (was /api/events.mux in 0.1.1).
      '/api/remote.mux': { ...dshLoopbackProxy(), ws: true },
      '/api/events.mux': { ...dshLoopbackProxy(), ws: true },
      '/api/events.host': { ...dshLoopbackProxy(), ws: true },
      '/api/dynamicCordisRunner': dshLoopbackProxy(),
      '/api/respond': dshLoopbackProxy(),
      '/api': {
        target: process.env.OD_API_PROXY || 'http://127.0.0.1:8082',
        changeOrigin: true
      },
      // P011: dsh HTML uses absolute /plugins + /assets (not under /dsh/).
      // When iframe loads /dsh/ from the Vite origin, those URLs hit :5173 and must
      // be proxied to the dsh process or the conversation page is blank.
      '/plugins': {
        target: process.env.OD_DSH_PROXY || 'http://127.0.0.1:3090',
        changeOrigin: true,
        ws: true
      },
      '/assets': {
        target: process.env.OD_DSH_PROXY || 'http://127.0.0.1:3090',
        changeOrigin: true
      },
      '/manifest.webmanifest': {
        target: process.env.OD_DSH_PROXY || 'http://127.0.0.1:3090',
        changeOrigin: true
      },
      // Only /od/* (bridge). Do NOT use '/od' — it also swallows public
      // files like /od-ip-B1-otter-lower-left.png and 404s them on dsh.
      '/od/': {
        target: process.env.OD_DSH_PROXY || 'http://127.0.0.1:3090',
        changeOrigin: true
      },
      // P011: DeepSeek Harness Web shell (HTML entry)
      '/dsh': dshEmbedProxy(),
    }
  }
})
