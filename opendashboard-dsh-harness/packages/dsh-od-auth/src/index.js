/**
 * OD auth bridge + BI product context injection.
 * Does not scan monorepo AGENTS.md or project cwd — that is disabled in cordis.patch.yml.
 * P014: POST /od/bridge remaps dsh workspace to tenants/od:{workspaceId}:{userId};
 * GET /od/sessions lists that partition (requires bridge).
 * @module @opendashboard/dsh-od-auth
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { getBridge, loadBridgeFromEnv, patchBridge, setBridge } from './bridge-state.js'
import { ensureOdDshWorkspace } from './od-workspace.js'

export const name = 'od-auth'
export const inject = ['webServer', 'workspaceRegistry', 'sessionPersistence']

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

  // Env / single-tenant bootstrap: bind partition without waiting for iframe POST.
  const boot = getBridge()
  if (boot.userId && boot.workspaceId) {
    ensureOdDshWorkspace(ctx.workspaceRegistry, boot)
      .then((bound) => {
        if (!bound) return
        patchBridge({
          dshWorkspaceId: bound.id,
          dshWorkspacePath: bound.path,
        })
      })
      .catch((err) => {
        ctx.logger?.warn?.(`od-auth: bootstrap workspace bind failed: ${err?.message || err}`)
      })
  }

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

    const corsOptions = (res) => {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
    }

    /**
     * Bind OD principal → durable dsh workspace under $DSH_HOME/tenants.
     * @param {import('./bridge-state.js').OdBridge} next
     */
    const bindOdWorkspace = async (next) => {
      const bound = await ensureOdDshWorkspace(ctx.workspaceRegistry, next)
      if (!bound) {
        return patchBridge({
          ...next,
          dshWorkspaceId: undefined,
          dshWorkspacePath: undefined,
        })
      }
      return patchBridge({
        ...next,
        dshWorkspaceId: bound.id,
        dshWorkspacePath: bound.path,
      })
    }

    webServer.register({
      kind: 'exact',
      path: '/od/bridge',
      async handler(req, res) {
        if (req.method === 'OPTIONS') {
          corsOptions(res)
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
            const partial = {
              userId: parsed.userId != null ? String(parsed.userId) : undefined,
              workspaceId: parsed.workspaceId != null ? String(parsed.workspaceId) : undefined,
              perms: parsed.perms != null ? String(parsed.perms) : undefined,
              conversationId: parsed.conversationId != null ? String(parsed.conversationId) : undefined,
              prompt: parsed.prompt != null ? String(parsed.prompt) : undefined,
              datasetId: parsed.datasetId ? String(parsed.datasetId) : undefined,
              dashboardId: parsed.dashboardId
                ? String(parsed.dashboardId)
                : (parsed.linkedDashboardId ? String(parsed.linkedDashboardId) : undefined),
              linkedDashboardId: parsed.linkedDashboardId
                ? String(parsed.linkedDashboardId)
                : (parsed.dashboardId ? String(parsed.dashboardId) : undefined),
            }
            const next = await bindOdWorkspace(partial)
            sendJson(res, 200, { ok: true, bridge: next })
          } catch (err) {
            sendJson(res, 400, { ok: false, error: String(err?.message || err) })
          }
          return
        }
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
      },
    })

    webServer.register({
      kind: 'exact',
      path: '/od/sessions',
      async handler(req, res) {
        if (req.method === 'OPTIONS') {
          corsOptions(res)
          return
        }
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const b = getBridge()
        if (!b.userId || !b.workspaceId) {
          sendJson(res, 401, { ok: false, error: 'unauthenticated: POST /od/bridge with userId and workspaceId first' })
          return
        }
        try {
          let path = b.dshWorkspacePath
          let workspaceId = b.dshWorkspaceId
          if (!path || !workspaceId) {
            const next = await bindOdWorkspace(b)
            path = next.dshWorkspacePath
            workspaceId = next.dshWorkspaceId
          }
          if (!path) {
            sendJson(res, 401, { ok: false, error: 'unauthenticated: missing OD workspace binding' })
            return
          }

          const headers = await ctx.sessionPersistence.list()
          const sessionsSvc = ctx.get?.('sessions')
          const titleSvc = ctx.get?.('sessionTitle')

          /** @type {Array<{ id: string, title: string, displayTitle: string, updatedAt: number, blank: boolean, origin?: string }>} */
          const rows = []
          for (const header of headers || []) {
            if (!header || header.origin === 'subagent') continue
            if (header.cwd !== path) continue
            const id = String(header.id)
            let title = ''
            let blank = false
            let updatedAt = Number(header.createdAt) || 0
            try {
              const live = sessionsSvc?.get?.(id)
              if (live) {
                const folded = titleSvc?.get?.(live)
                if (folded?.title) title = String(folded.title)
                const events = live.events || []
                blank = !events.some((e) => e?.type === 'user/message')
                if (events.length) {
                  const last = events[events.length - 1]
                  if (typeof last?.time === 'number') updatedAt = last.time
                }
              }
            } catch {
              /* live title optional */
            }
            const displayTitle = title || (blank ? '新会话' : id.slice(0, 8))
            rows.push({
              id,
              title: title || displayTitle,
              displayTitle,
              updatedAt,
              blank,
              origin: header.origin,
            })
          }
          rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          sendJson(res, 200, {
            ok: true,
            dshWorkspaceId: workspaceId,
            dshWorkspacePath: path,
            sessions: rows.slice(0, 40),
          })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err?.message || err) })
        }
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
      const linked = b.dashboardId || b.linkedDashboardId
      if (linked) {
        lines.push(`- Linked draft dashboardId: ${linked}. Chart edits must od_rechart_chart this id (merge). Full rewrite: od_board_worker with the same id in the prompt. Never omit it.`)
      }
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
