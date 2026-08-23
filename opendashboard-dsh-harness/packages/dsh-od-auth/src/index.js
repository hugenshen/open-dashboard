/**
 * OD auth bridge + BI product context injection.
 * Does not scan monorepo AGENTS.md or project cwd — that is disabled in cordis.patch.yml.
 * @module @opendashboard/dsh-od-auth
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { getBridge, loadBridgeFromEnv, patchBridge, setBridge } from './bridge-state.js'

export const name = 'od-auth'
export const inject = ['webServer']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  loadBridgeFromEnv()

  ctx.provide('odAuth', {
    getBridge,
    /** @param {import('./bridge-state.js').OdBridge} next */
    setBridge(next) {
      setBridge(next)
    },
    patchBridge,
  })

  // Browser (OD AppShell iframe) posts the logged-in principal so od_* tools
  // use the same user/workspace/perms as the dataset page — not the start.sh demo.
  const webServer = ctx.webServer
  if (webServer) {
    const sendJson = (res, status, body) => {
      const raw = JSON.stringify(body)
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end(raw)
    }
    const readBody = (req) => new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

    webServer.register({
      kind: 'exact',
      path: '/od/bridge',
      async handler(req, res) {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
          return
        }
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, bridge: getBridge() })
          return
        }
        if (req.method === 'POST') {
          try {
            const raw = await readBody(req)
            const parsed = raw ? JSON.parse(raw) : {}
            const next = patchBridge({
              userId: parsed.userId != null ? String(parsed.userId) : undefined,
              workspaceId: parsed.workspaceId != null ? String(parsed.workspaceId) : undefined,
              perms: parsed.perms != null ? String(parsed.perms) : undefined,
              conversationId: parsed.conversationId != null ? String(parsed.conversationId) : undefined,
              prompt: parsed.prompt != null ? String(parsed.prompt) : undefined,
              datasetId: parsed.datasetId != null ? String(parsed.datasetId) : undefined,
            })
            sendJson(res, 200, { ok: true, bridge: next })
          } catch (err) {
            sendJson(res, 400, { ok: false, error: String(err?.message || err) })
          }
          return
        }
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
      },
    })

    // Boot script: read #od_bridge= from the iframe URL and POST it to the server.
    // Also expose Vue AppShell origin so board cards can link to /dashboards/:id/edit
    // (those routes are not served by native dsh on :3090).
    ctx.on('webserver/index-inject', (table) => {
      const appOrigin = String(process.env.OD_APP_ORIGIN || '').trim().replace(/\/$/, '')
      table.push({
        kind: 'script',
        placement: 'head',
        text: `window.__OD_APP_ORIGIN=${JSON.stringify(appOrigin)};`,
      })
      table.push({
        kind: 'script',
        placement: 'head',
        text: `(function(){try{var h=location.hash||'';var m=h.match(/od_bridge=([^&]+)/);if(!m)return;var b=JSON.parse(decodeURIComponent(m[1]));fetch('/od/bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),credentials:'same-origin'}).catch(function(){})}catch(e){}})();`,
      })
    })
  }

  // Once per turn: OD tenant context only (no filesystem / git paths).
  ctx.on(
    'agent/pre-step',
    async ({ step, signal }, next) => {
      const decision = await next()
      if (!decision || decision.kind === 'reject' || signal?.aborted) return decision
      if (step !== 1) return decision

      const b = getBridge()
      const workspaceId = b.workspaceId || '(unset — open DataQ 对话分析 so the shell can bind workspace)'
      const userId = b.userId || '(unset)'
      const perms = b.perms || '(unset)'
      const lines = [
        'DataQ workspace context (internal; do not quote or recap to the user):',
        `- workspaceId: ${workspaceId}`,
        `- userId: ${userId}`,
        `- perms: ${perms}`,
        '- Product name is DataQ. Do not use any other product name in replies.',
        '- You are NOT a coding agent. Do not read or modify source files, shells, or local disks.',
        '- Data access is only via od_* tools against Java BI for this workspace.',
        '- Prefer od_list_datasets before answering what data exists. Use the returned id fields (e.g. ds_…), never invent table names.',
        '- Do not list tools or a capability menu unless the user asks what you can do.',
      ]
      if (b.datasetId) {
        lines.push(`- Preferred datasetId from knowledge hub: ${b.datasetId}`)
      }
      if (b.prompt) {
        lines.push(`- Seeded question from 试问 (treat as the user question this turn): ${b.prompt}`)
      }
      const text = lines.join('\n')

      return {
        kind: 'enter',
        messages: [
          ...(decision.messages || []),
          createUserMessage({
            content: [{ type: 'text', text }],
            source: {
              kind: 'plugin',
              plugin: name,
              form: 'snapshot',
              sections: [{ name, text }],
            },
          }),
        ],
      }
    },
    { prepend: true },
  )
}

export { getBridge, setBridge, patchBridge, loadBridgeFromEnv }
