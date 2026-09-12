import { createHash } from 'node:crypto'
import { getBridge } from '@opendashboard/dsh-od-auth/bridge-state'
import { biFetch } from './http.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function reportBrief(args = {}) {
  const bridge = getBridge()
  const ambiguities = []
  if (!args.audience) ambiguities.push('audience')
  if (!args.timeRange || !Object.keys(args.timeRange).length) ambiguities.push('timeRange')
  if (!Array.isArray(args.metrics) || !args.metrics.length) ambiguities.push('metrics')
  if (!args.comparison || !Object.keys(args.comparison).length) ambiguities.push('comparison')
  return {
    title: String(args.reportTitle || args.title || '分析报告'),
    goal: String(bridge.prompt || args.goal || args.reportTitle || '生成可追溯的数据分析报告'),
    audience: String(args.audience || ''),
    timeRange: args.timeRange || {},
    datasets: bridge.datasetId ? [String(bridge.datasetId)] : (Array.isArray(args.datasetIds) ? args.datasetIds.map(String) : []),
    metrics: Array.isArray(args.metrics) ? args.metrics : [],
    comparison: args.comparison || {},
    output: { tone: String(args.tone || 'business'), detail: String(args.detail || 'standard'), formats: ['html', 'markdown'] },
    constraints: ['结论必须引用证据', '数据不足时明确限制，不猜测'],
    ambiguities,
    confirmed: ambiguities.length === 0,
  }
}

export async function createRemoteReportRun(args = {}) {
  const bridge = getBridge()
  const conversationId = String(bridge.conversationId || '').trim()
  if (!conversationId) return { ok: false, optional: true, error: 'conversationId unavailable' }
  const requestedBudget = args.budget && typeof args.budget === 'object' ? args.budget : {}
  const created = await biFetch('POST', `/api/conversations/${encodeURIComponent(conversationId)}/report-runs`, {
    brief: reportBrief(args),
    budget: { maxTasks: 4, concurrency: 2, maxQueries: 16, maxPythonCalls: 4, maxRows: 200,
      queryTimeoutSeconds: 15, totalTimeoutSeconds: 900, ...requestedBudget },
  })
  const runId = String(created?.run?.id || '')
  if (!runId) throw new Error('report run create returned no runId')
  const tasks = (args.tasks || []).map((task, index) => ({
    taskId: String(task.id || `analysis-${index + 1}`),
    title: String(task.title || task.task || `分析任务 ${index + 1}`),
    task: String(task.task || task.title || ''),
    businessKnowledge: String(task.businessKnowledge || task.business_knowledge || ''),
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
  }))
  const planned = await biFetch('PUT', `/api/conversations/${encodeURIComponent(conversationId)}/report-runs/${encodeURIComponent(runId)}/plan`, {
    expectedVersion: Number(created?.run?.planVersion || 0),
    plan: { title: String(args.reportTitle || args.title || '分析报告'), taskCount: tasks.length },
    tasks,
  })
  return { ok: true, conversationId, runId, planVersion: Number(planned?.run?.planVersion || 1), status: planned?.run?.status }
}

export async function waitForRemotePlanApproval(remote, { timeoutMs = 300_000, signal } = {}) {
  if (!remote?.runId || !remote?.conversationId) return { ok: true, optional: true }
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw signal.reason || new Error('approval wait aborted')
    const detail = await biFetch('GET', `/api/conversations/${encodeURIComponent(remote.conversationId)}/report-runs/${encodeURIComponent(remote.runId)}`)
    const status = detail?.run?.status
    if (status === 'running') return { ok: true, status, runId: remote.runId, planVersion: detail?.run?.approvedPlanVersion,
      tasks: detail?.tasks || [], budget: detail?.run?.budget || {} }
    if (['cancelled', 'failed'].includes(status)) return { ok: false, status, error: `report run ${status}` }
    await sleep(1000)
  }
  return { ok: false, status: 'awaiting_plan_approval', error: '等待用户确认计划超时，可在报告工作区确认后重试。' }
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function numericTokens(value) {
  return String(value || '').match(/(?<![\w.-])-?\d+(?:,\d{3})*(?:\.\d+)?%?/g) || []
}

function evidenceNumbers(block) {
  const out = []
  const visit = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(block?.rows || [])
  return out
}

export function quantitativeClaims(markdown, evidenceRows, artifactVersion) {
  const sentences = String(markdown || '').split(/[。！？\n]+/).map((x) => x.trim())
    .filter((x) => x && !x.startsWith('#') && !x.startsWith('|') && numericTokens(x).length)
  return sentences.map((statement, index) => {
    const tokens = numericTokens(statement).map((x) => Number(x.replace(/[,％%]/g, ''))).filter(Number.isFinite)
    const matched = evidenceRows.filter(({ block }) => {
      const values = evidenceNumbers(block)
      return tokens.some((token) => values.some((value) => Math.abs(value - token) <= Math.max(.0001, Math.abs(value) * .00001)
        || Math.abs(value * 100 - token) <= .0001))
    })
    return {
      artifactVersion, sectionId: `quantitative-${index + 1}`, claimType: 'fact', statement,
      evidenceRefs: matched.map(({ evidence }) => String(evidence.id)), confidence: matched.length ? 'high' : 'low',
      caveat: matched.length ? null : '未找到数值完全一致的结构化证据',
    }
  })
}

export async function publishRemoteReportResult(remote, result, session) {
  if (!remote?.runId || result?.ok === false) return { ok: true, optional: true }
  const evidenceRows = []
  for (const block of Array.isArray(session?.insights) ? session.insights : []) {
    const measureField = (block.fields || []).find((field) => String(field.name || field.field || '') === String(block.chart?.encode?.value || ''))
    const evidence = await biFetch('POST', `/api/internal/report-runs/${encodeURIComponent(remote.runId)}/evidence`, {
      datasetId: String(block.chart?.datasetId || block.handle || 'analysis-frame'),
      queryFingerprint: digest({ chart: block.chart, fields: block.fields }),
      metric: { field: block.chart?.encode?.value || '', agg: block.chart?.encode?.agg || '' },
      filters: Array.isArray(block.chart?.encode?.filters) ? block.chart.encode.filters : [],
      timeRange: block.chart?.encode?.timeRange || { label: '报告简报约定范围' },
      unit: block.chart?.encode?.unit || { source: measureField?.unit || 'not_declared', display: measureField?.displayUnit || measureField?.unit || 'raw' },
      denominator: block.chart?.encode?.denominator || {},
      resultDigest: digest(block.rows || []),
      resultSummary: { rowCount: block.rowCount || 0, title: block.title || '' },
      sampleRows: Array.isArray(block.rows) ? block.rows.slice(0, 20) : [],
    })
    evidenceRows.push({ block, evidence })
  }
  const md = await biFetch('POST', `/api/internal/report-runs/${encodeURIComponent(remote.runId)}/artifacts`, {
    kind: 'final_md', filename: String(result.filename || 'analysis-report.md').replace(/\.html?$/i, '.md'),
    contentType: 'text/markdown', content: String(result.markdown || ''), evidenceSetVersion: 1,
  })
  await biFetch('POST', `/api/internal/report-runs/${encodeURIComponent(remote.runId)}/artifacts`, {
    artifactVersion: Number(md.artifactVersion || 1), kind: 'final_html',
    filename: String(result.filename || 'analysis-report.html').replace(/\.md$/i, '.html'),
    contentType: 'text/html', content: String(result.html || ''), evidenceSetVersion: 1,
  })
  const insightClaims = evidenceRows.flatMap(({ block, evidence }) => (block.items || []).map((item, index) => ({
    artifactVersion: Number(md.artifactVersion || 1), sectionId: `finding-${index + 1}`,
    claimType: 'fact', statement: String(item.text || ''), evidenceRefs: [String(evidence.id)], confidence: 'medium',
  })))
  const numericClaims = quantitativeClaims(result.markdown, evidenceRows, Number(md.artifactVersion || 1))
  const claims = [...insightClaims, ...numericClaims.filter((claim) => !insightClaims.some((item) => item.statement === claim.statement))]
  const checks = {
    nonEmpty: Boolean(result.markdown && result.html),
    evidenceCount: evidenceRows.length,
    claimCount: claims.length,
  }
  const quality = await biFetch('POST', `/api/internal/report-runs/${encodeURIComponent(remote.runId)}/quality-results`, {
    quality: { repairAttempt: 0 },
    claims,
  })
  return { ok: quality?.run?.status === 'ready', status: quality?.run?.status, runId: remote.runId, quality: quality?.run?.quality }
}
