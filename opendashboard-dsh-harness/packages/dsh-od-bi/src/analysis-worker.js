/**
 * P016 analysis-report worker tools (JoyAgent AutoAnalysis analogue).
 * Lead must spawn od_board_worker with ANALYSIS_REPORT=1.
 * Worker: get_data → python/data_trans → insight(method) → save_insight → commit_report.
 * @module @opendashboard/dsh-od-bi/analysis-worker
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { reportPresentationMeta } from './answer-meta.js'
import { runAnalysisPython } from './analysis-python.js'
import {
  activateAnalysisSession,
  boardSessionKey,
  deactivateAnalysisSession,
  getBoardSession,
  getFrame,
  rememberPresentation,
  resetBoardSession,
} from './board-store.js'
import { toLosslessJson } from './http.js'
import { computeInsights, insightNote, looksLikeDetailDump, normalizeInsightMethod, INSIGHT_METHODS } from './insight.js'
import { renderAuthoredReport, renderReport } from './report-render.js'
import {
  completeAnalysisPlanTask,
  resetReportProgress,
  setAnalysisPlan,
  setReportAuthority,
  trackAnalysisTool,
} from './report-progress.js'
import { createRemoteReportRun, publishRemoteReportResult, waitForRemotePlanApproval } from './report-run-client.js'
import { acquireReportTask, consumeReportBudget, initializeReportExecution } from './report-execution.js'
import { fname, isEntitySubjectDim, parseValueMapFromLabel } from './gen-board.js'

export const ANALYSIS_TOOL_NAMES = Object.freeze([
  'od_analysis_plan',
  'od_wait_report_approval',
  'od_python',
  'od_insight',
  'od_save_insight',
  'od_complete_analysis_task',
  'od_read_analysis_files',
  'od_commit_report',
])

function sessionOf(opts) {
  return opts.session || getBoardSession()
}

function planRequired(session = getBoardSession()) {
  if (!session.analysisPlan) return { ok: false, error: 'JoyAgent workflow requires od_get_schema then od_analysis_plan first.' }
  if (session.meta?.reportRunId && !session.meta?.reportPlanApproved) {
    return { ok: false, error: 'Report plan requires explicit user approval. Call od_wait_report_approval before executing data tasks.' }
  }
  return null
}

function ensureInsights(session) {
  if (!Array.isArray(session.insights)) session.insights = []
  return session.insights
}

function insightOpts(args, frame) {
  return {
    breakdown: args.breakdown || frame.chart?.encode?.category,
    measure: args.measure || frame.chart?.encode?.value,
    analysisMethod: args.analysisMethod || args.analysis_method,
    isSeries: args.isSeries,
  }
}

function usableInsights(items) {
  return (Array.isArray(items) ? items : []).filter((it) => it && it.type !== 'rejected' && it.type !== 'sparse' && it.text)
}

function frameCategoryField(frame, breakdown) {
  const category = String(breakdown || frame?.chart?.encode?.category || '')
  return (Array.isArray(frame?.fields) ? frame.fields : []).find((f) => fname(f) === category)
}

function isEntityAggregate(frame, breakdown) {
  const category = String(breakdown || frame?.chart?.encode?.category || '')
  const value = String(frame?.chart?.encode?.value || '')
  return Boolean(category && category !== value && isEntitySubjectDim(frameCategoryField(frame, category)))
}

function semanticRows(frame) {
  const category = String(frame?.chart?.encode?.category || '')
  const value = String(frame?.chart?.encode?.value || '')
  const categoryField = frameCategoryField(frame, category)
  const valueMap = categoryField?.valueMap || parseValueMapFromLabel(categoryField?.label)
  return (Array.isArray(frame?.rows) ? frame.rows : []).map((row) => {
    const rawCategory = Array.isArray(row) ? row[0]
      : row && typeof row === 'object' ? (row[category] ?? row.label) : row
    const rawValue = Array.isArray(row) ? row[1]
      : row && typeof row === 'object' ? (row[value] ?? row.value) : undefined
    return {
      [category || 'label']: valueMap?.[String(rawCategory)]
        ?? (valueMap && Object.keys(valueMap).length ? `未定义状态（${String(rawCategory)}）` : rawCategory),
      [value || 'value']: rawValue,
    }
  })
}

function resolveCurrentAnalysisFrame(session, requestedHandle) {
  const requested = String(requestedHandle || '')
  const exact = getFrame(session, requested)
  if (exact) return { handle: requested, frame: exact, recovered: false }
  const taskIndex = Number.isFinite(Number(session.meta?.analysisTaskIndex))
    ? Number(session.meta.analysisTaskIndex)
    : 0
  const entries = [...session.frames.entries()]
  const currentTask = entries.filter(([, frame]) => Number(frame?.taskIndex) === taskIndex)
  const fallback = currentTask.at(-1) || entries.at(-1)
  if (!fallback) return null
  return { handle: String(fallback[0]), frame: fallback[1], recovered: true }
}

export function runInsight(args, opts = {}) {
  const session = sessionOf(opts)
  const resolved = resolveCurrentAnalysisFrame(session, args.handle)
  if (!resolved) return { ok: false, error: 'unknown handle — call od_get_data first' }
  const { handle, frame, recovered } = resolved
  const method = normalizeInsightMethod(args.analysisMethod || args.analysis_method)
  if ((args.analysisMethod || args.analysis_method) && !method) {
    return { ok: false, error: `analysis_method must be one of ${INSIGHT_METHODS.join('|')}` }
  }
  if (!isEntityAggregate(frame, args.breakdown) && looksLikeDetailDump(frame.rows, args.breakdown || frame.chart?.encode?.category)) {
    return {
      ok: false,
      error: '明细/高基数 ID 不能做洞察 — 换状态、渠道、类型等分类维再 od_get_data',
    }
  }
  const items = computeInsights(semanticRows(frame), insightOpts(args, frame))
  const useful = usableInsights(items)
  const taskIndex = Number.isFinite(Number(session.meta?.analysisTaskIndex)) ? Number(session.meta.analysisTaskIndex) : 0
  const evidenceOnlyCompletion = !useful.length && session.analysisPlan?.tasks?.[taskIndex]
    ? runCompleteAnalysisTask({ taskIndex, summary: '已保留聚合证据；未识别到通过显著性门控的额外洞察。' }, { session })
    : null
  return toLosslessJson({
    ok: true,
    handle,
    analysisMethod: method || null,
    rowCount: frame.rowCount || 0,
    suggestedChartType: frame.suggestedChartType || null,
    insights: useful,
    taskCompleted: Boolean(evidenceOnlyCompletion?.ok),
    analysisFile: evidenceOnlyCompletion?.ok ? evidenceOnlyCompletion.filename : null,
    note: evidenceOnlyCompletion?.ok
      ? `未形成显著洞察，已直接用聚合证据生成 ${evidenceOnlyCompletion.filename}；不要继续探测当前任务，请执行下一任务。`
      : `${recovered ? `已自动改用当前任务最近的聚合结果 ${handle}。` : ''}${insightNote(useful, method)}`,
  })
}

export function runSaveInsight(args, opts = {}) {
  const session = sessionOf(opts)
  const resolved = resolveCurrentAnalysisFrame(session, args.handle)
  if (!resolved) return { ok: false, error: 'unknown handle — call od_get_data first' }
  const { handle, frame, recovered } = resolved
  if (!frame.rowCount) {
    return { ok: false, error: 'empty result cannot be saved — retry od_get_data with another dim' }
  }
  if (!isEntityAggregate(frame, args.breakdown) && looksLikeDetailDump(frame.rows, args.breakdown || frame.chart?.encode?.category)) {
    return { ok: false, error: '明细切片不能保存 — 换分类维再取数' }
  }
  const computed = usableInsights(computeInsights(semanticRows(frame), insightOpts(args, frame)))
  let items = computed
  if (typeof args.insight === 'string' && args.insight.trim()) {
    items = args.insight.split('<sep>').map((text) => ({ type: 'narrative', text: text.trim(), score: 1 }))
      .filter((it) => it.text && !/无分析结论/.test(it.text))
  } else if (Array.isArray(args.insights) && args.insights.length) {
    items = args.insights
  }
  if (!items.length) {
    return { ok: false, error: '无分析结论 — 不要保存；换维、换 analysis_method 或先 od_python' }
  }
  const block = {
    taskIndex: Number.isFinite(Number(args.taskIndex)) ? Number(args.taskIndex) : Number(session.meta.analysisTaskIndex || 0),
    handle,
    title: String(args.title || frame.chart?.title || frame.chart?.question || handle),
    process: String(args.process || args.analysisProcess || args.analysis_process || ''),
    suggestedChartType: frame.suggestedChartType || null,
    rowCount: frame.rowCount,
    rows: semanticRows(frame).slice(0, 20),
    chart: frame.chart,
    fields: frame.fields,
    items,
  }
  ensureInsights(session).push(block)
  session.meta.purpose = 'analysis'
  const saved = {
    ok: true,
    handle,
    savedCount: session.insights.length,
    suggestedChartType: block.suggestedChartType,
    title: block.title,
    note: `${recovered ? `Automatically used the latest task frame ${handle}. ` : ''}Saved snapshot insight. Continue other questions / methods, then od_commit_report once.`,
  }
  return toLosslessJson(saved)
}

function normalizeTasks(input) {
  const raw = Array.isArray(input) ? input : []
  return raw.map((task, index) => ({
    id: String(task?.id || `analysis-${index + 1}`),
    title: String(task?.title || task?.task || `分析任务 ${index + 1}`),
    task: String(task?.task || task?.title || `分析任务 ${index + 1}`),
    businessKnowledge: String(task?.businessKnowledge || task?.business_knowledge || ''),
    dependsOn: Array.isArray(task?.dependsOn) ? task.dependsOn.map(String) : [],
    budget: task?.budget && typeof task.budget === 'object' ? task.budget : {},
    status: 'not_started',
  }))
}

export function runAnalysisPlan(args, opts = {}) {
  const session = opts.session || resetBoardSession(boardSessionKey())
  activateAnalysisSession(session.key)
  resetReportProgress(session.key)
  if (session.analysisPlan?.tasks?.length) return { ok: false, error: 'od_analysis_plan may only be called once per report run' }
  const tasks = normalizeTasks(args.tasks)
  if (!tasks.length) return { ok: false, error: 'tasks must contain at least one analysis subtask' }
  const executionBudget = initializeReportExecution(session, args.budget || {})
  if (tasks.length > executionBudget.maxTasks) {
    return { ok: false, needsAction: true, error: `REPORT_BUDGET_EXCEEDED:maxTasks:${executionBudget.maxTasks}`,
      disclosure: `报告计划包含 ${tasks.length} 个任务，超过 maxTasks=${executionBudget.maxTasks}。` }
  }
  session.analysisPlan = {
    title: String(args.reportTitle || args.title || '分析报告'),
    tasks,
  }
  session.analysisFiles = []
  session.insights = []
  session.meta.purpose = 'analysis'
  session.meta.analysisTaskIndex = 0
  const progress = setAnalysisPlan({
    reportTitle: session.analysisPlan.title,
    tasks,
  }, { key: session.key })
  return toLosslessJson({
    ok: true,
    reportTitle: session.analysisPlan.title,
    taskCount: tasks.length,
    tasks: tasks.map(({ id, title, task, businessKnowledge }) => ({ id, title, task, businessKnowledge })),
    note: 'Plan created. Execute each data_analysis task in order, then generate one task file.',
    progress,
  })
}

/**
 * A successful report keeps its result for idempotent duplicate commits, but
 * that retained state must never become the execution context of the next
 * report requested in the same conversation.
 */
export function sessionForNewAnalysisPlan(candidate = getBoardSession()) {
  return candidate.meta?.completedReport?.ok
    ? resetBoardSession(candidate.key)
    : candidate
}

async function persistAnalysisPlan(args, result, session) {
  if (!result?.ok) return result
  try {
    const remote = await createRemoteReportRun(args)
    if (!remote.ok) return { ...result, authority: remote }
    session.meta.reportRunId = remote.runId
    session.meta.reportConversationId = remote.conversationId
    session.meta.reportPlanVersion = remote.planVersion
    session.meta.reportPlanApproved = false
    setReportAuthority(remote, { key: session.key })
    return { ...result, reportRunId: remote.runId, planVersion: remote.planVersion, requiresApproval: true,
      note: 'Plan persisted. Call od_wait_report_approval and wait for the user to confirm it in the report workspace.' }
  } catch (error) {
    return { ...result, authority: { ok: false, optional: true, error: String(error?.message || error) } }
  }
}

async function waitReportApproval(args = {}, opts = {}) {
  const session = sessionOf(opts)
  if (!session.meta?.reportRunId) return { ok: true, optional: true, note: 'No authoritative run is attached in this context.' }
  const remote = {
    runId: session.meta.reportRunId,
    conversationId: session.meta.reportConversationId,
    planVersion: session.meta.reportPlanVersion,
  }
  const result = await waitForRemotePlanApproval(remote, { timeoutMs: Number(args.timeoutMs || 300_000) })
  if (result.ok) {
    session.meta.reportPlanApproved = true
    if (Array.isArray(result.tasks) && result.tasks.length) {
      session.analysisPlan.tasks = result.tasks.map((task, index) => ({
        ...normalizeTasks([task.spec || {}])[0],
        id: String(task.spec?.taskId || task.taskKey || `analysis-${index + 1}`),
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
        budget: task.budget || {},
        status: 'not_started',
      }))
      session.meta.reportPlanVersion = Number(result.planVersion || session.meta.reportPlanVersion)
      initializeReportExecution(session, result.budget || {})
    }
    setReportAuthority({ ...remote, status: 'running' }, { key: session.key })
  }
  return result
}

function markdownEvidenceTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return '无可展示的结构化证据行。'
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))]
  if (!columns.length) return '无可展示的结构化证据行。'
  const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  return [
    `| ${columns.map(escape).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => escape(row?.[column])).join(' | ')} |`),
  ].join('\n')
}

function taskFileMarkdown(task, blocks, summary) {
  const sections = blocks.map((block) => {
    const findings = (block.items || []).map((item) => `- ${item.text}`).join('\n') || '- 无可保存结论'
    const rows = Array.isArray(block.rows) ? block.rows : []
    return `## ${block.title}\n\n分析方法：${block.process || '聚合描述与显著性检查'}\n\n数据快照：查询返回 ${block.rowCount || rows.length} 行；以下保留最多 20 行真实聚合证据。\n\n${markdownEvidenceTable(rows)}\n\n### 基于证据的结论\n\n${findings}`
  }).join('\n\n')
  return `# ${task.title}\n\n## 任务\n\n${task.task}\n\n## 业务知识\n\n${task.businessKnowledge || '未提供额外业务知识，仅依据 schema 与聚合结果。'}\n\n${sections}\n\n## 子任务总结\n\n${String(summary || '').trim() || blocks.flatMap((block) => block.items || []).map((item) => item.text).filter(Boolean).join('\n')}`
}

function evidenceBlocksForTask(session, taskIndex) {
  const frames = session.frames instanceof Map ? [...session.frames.values()] : []
  return frames
    .filter((frame) => Number(frame?.taskIndex) === Number(taskIndex)
      && Number(frame?.rowCount || 0) > 0 && frame?.suggestedChartType)
    .filter((frame) => isEntityAggregate(frame) || !looksLikeDetailDump(frame.rows, frame.chart?.encode?.category))
    .map((frame) => ({
      taskIndex: Number(taskIndex),
      handle: frame.handle,
      title: String(frame.chart?.title || frame.chart?.question || `任务 ${Number(taskIndex) + 1} 聚合证据`),
      process: '保留聚合证据；未识别到通过显著性门控的额外洞察',
      suggestedChartType: frame.suggestedChartType,
      rowCount: frame.rowCount,
      rows: semanticRows(frame).slice(0, 20),
      chart: frame.chart,
      fields: frame.fields,
      items: [],
    }))
}

function budgetLimitationForTask(session, taskIndex) {
  const limitations = Array.isArray(session.meta?.reportBudgetLimitations)
    ? session.meta.reportBudgetLimitations
    : []
  const taskLevel = limitations.find((item) => item.scope === 'task'
    && item.kind === 'query' && Number(item.taskIndex) === Number(taskIndex))
  if (taskLevel) return taskLevel
  return limitations.find((item) => item.scope === 'report' && ['query', 'time'].includes(item.kind)) || null
}

function taskLimitationMarkdown(task, limitation) {
  return `# ${task.title}\n\n## 任务\n\n${task.task}\n\n## 分析限制\n\n${limitation.disclosure}\n\n本子任务未形成可验证的数据证据，因此不输出渠道、商户、趋势、比例或其他事实性结论。最终报告必须明确标注此缺口及其对结论完整性的影响，不得根据其他子任务推断本任务结果。\n\n## 建议恢复方式\n\n缩小本任务范围或提高预算后单独重试；本轮先使用已经完成的子任务证据生成部分报告。`
}

function materializeBudgetLimitationFiles(session) {
  const plan = session.analysisPlan
  if (!plan?.tasks?.length) return []
  session.analysisFiles ||= []
  const created = []
  plan.tasks.forEach((task, index) => {
    if (session.analysisFiles.some((file) => Number(file.taskIndex) === index)) return
    const limitation = budgetLimitationForTask(session, index)
    if (!limitation) return
    const content = taskLimitationMarkdown(task, limitation)
    const file = {
      name: `analysis-task-${index + 1}-limitation.md`,
      type: 'markdown',
      content,
      size: Buffer.byteLength(content, 'utf8'),
      taskIndex: index,
      taskId: task.id,
      limitationOnly: true,
      limitation: limitation.disclosure,
    }
    session.analysisFiles.push(file)
    task.status = 'skipped'
    task.skipReason = limitation.disclosure
    completeAnalysisPlanTask(index, file, { key: session.key })
    created.push(file)
  })
  return created
}

function stableEvidenceDigest(value) {
  const text = JSON.stringify(value ?? null)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function evidenceUnit(block) {
  const measure = String(block?.chart?.encode?.value || '')
  const field = (Array.isArray(block?.fields) ? block.fields : []).find((item) => fname(item) === measure)
  const label = String(field?.label || '')
  const match = label.match(/(?:单位|unit)\s*[:：]?\s*([\p{L}%￥¥]+)|\b(fen|yuan|cny|rmb|percent)\b/iu)
  return match ? String(match[1] || match[2] || '') : ''
}

function reportEvidence(session, insights) {
  return (Array.isArray(insights) ? insights : []).map((block) => {
    const rows = (Array.isArray(block?.rows) ? block.rows : []).filter((row) => (
      row && typeof row === 'object' && Object.values(row).some((value) => value != null && value !== '')
    )).slice(0, 20)
    if (!rows.length) return null
    const encode = block?.chart?.encode || {}
    const task = session.analysisPlan?.tasks?.[Number(block?.taskIndex || 0)]
    return {
      datasetId: String(block?.datasetId || session.meta?.datasetId || ''),
      metric: String(encode.value || block?.title || task?.title || '聚合指标'),
      aggregation: String(encode.agg || 'aggregate'),
      filters: block?.chart?.filter ? { expression: block.chart.filter } : undefined,
      unit: evidenceUnit(block) || undefined,
      resultSummary: {
        title: String(block?.title || task?.title || `分析证据 ${index + 1}`),
        rowCount: Number(block?.rowCount || rows.length),
        rows,
      },
      resultDigest: stableEvidenceDigest(rows),
      taskIndex: Number(block?.taskIndex || 0),
    }
  }).filter(Boolean).map((item, index) => ({ ...item, id: `local-ev-${index + 1}` }))
}

function coreFindingStatements(markdown) {
  const text = String(markdown || '')
  const section = text.match(/(?:^|\n)##[^\n]*(?:核心发现|核心结论)[^\n]*\n([\s\S]*?)(?=\n##\s|$)/)?.[1] || ''
  const bullets = [...section.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((match) => match[1].trim())
  if (bullets.length) return bullets.slice(0, 8)
  return section.split(/\n\s*\n/).map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item && !item.startsWith('#')).slice(0, 8)
}

function reportClaims(markdown, evidence) {
  const allRefs = evidence.map((item) => item.id)
  return coreFindingStatements(markdown).map((statement, index) => {
    const matched = evidence.filter((item) => {
      const summary = item.resultSummary || {}
      const tokens = [item.metric, summary.title, ...(Array.isArray(summary.rows)
        ? summary.rows.flatMap((row) => Object.values(row || {})) : [])]
        .map(String).filter((token) => token.length >= 2)
      return tokens.some((token) => statement.includes(token))
    }).map((item) => item.id)
    return {
      id: `local-cl-${index + 1}`,
      statement,
      evidenceRefs: matched.length ? matched : allRefs,
      validationStatus: 'pass',
    }
  })
}

function extractReportEvidenceTokens(files) {
  const tokens = []
  const add = (value) => {
    const token = String(value ?? '').trim()
    if (!token || token.length < 2 || tokens.includes(token)) return
    // Section labels such as “商户 Top” are not business entity values. Keeping
    // them would make the quality guard ask the model to cite a fake entity.
    if (/^(id|mchid|merchant|merchantid|appid|agent|agentid|store|storeid|top|bottom|rank|ranking|total|sum|count|value|amount)$/i.test(token)) return
    if (/^-?\d+(?:\.\d+)?%?$/.test(token.replace(/,/g, ''))) return
    tokens.push(token)
  }
  for (const file of Array.isArray(files) ? files : []) {
    const text = String(file?.content || '')
    if (!text) continue
    for (const match of text.matchAll(/商户\s*([A-Za-z0-9_-]{2,})/g)) add(match[1])
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const header = lines[i]
      if (!/^\|.*\|$/.test(header) || !/(MchId|商户|Merchant|merchant|AppId|应用|Agent|代理|Store|门店)/.test(header)) continue
      const columns = header.split('|').slice(1, -1).map((s) => s.trim())
      const entityIndexes = columns
        .map((column, index) => (/(MchId|商户|Merchant|merchant|AppId|应用|Agent|代理|Store|门店)/.test(column) ? index : -1))
        .filter((index) => index >= 0)
      for (const rowLine of lines.slice(i + 2, i + 10)) {
        if (!/^\|.*\|$/.test(rowLine)) break
        const cells = rowLine.split('|').slice(1, -1).map((s) => s.trim())
        entityIndexes.forEach((index) => add(cells[index]))
      }
    }
  }
  return tokens.slice(0, 12)
}

function extractReportNumericEvidenceTokens(files) {
  const tokens = []
  const add = (value) => {
    const token = String(value ?? '').trim().replace(/,/g, '')
    if (!token || tokens.includes(token)) return
    if (!/^-?\d+(?:\.\d+)?%?$/.test(token)) return
    const numeric = Number(token.replace(/%$/, ''))
    if (!Number.isFinite(numeric)) return
    // Keep business-scale numbers and percentages; skip pure section/status noise
    // unless the token is part of an evidence table with enough digits.
    if (Math.abs(numeric) < 10 && !token.includes('.') && !token.endsWith('%')) return
    tokens.push(token)
  }
  for (const file of Array.isArray(files) ? files : []) {
    const text = String(file?.content || '')
    if (!text) continue
    for (const match of text.matchAll(/(?<![A-Za-z])(-?\d[\d,]*(?:\.\d+)?%?)(?![A-Za-z])/g)) {
      add(match[1])
    }
  }
  return tokens.slice(0, 20)
}

function reportIncludesNumericEvidence(normalizedText, token) {
  const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const has = (value) => new RegExp(`(^|[^0-9.])${escape(value)}(?![0-9.])`).test(normalizedText)
  if (has(token)) return true
  if (String(token).endsWith('%')) return false
  const numeric = Number(token)
  // Amount/MchIncome/AgentProfit are stored in 分 but business reports are
  // expected to present 元. Treat the exact ÷100 representation as the same
  // traceable evidence instead of rejecting a correct unit conversion.
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 100) return false
  return has(String(numeric / 100))
}

function evidencePairsFromFiles(files) {
  const pairs = []
  const splitRow = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/\\\|/g, '|'))
  for (const file of Array.isArray(files) ? files : []) {
    const lines = String(file?.content || '').split(/\r?\n/)
    for (let i = 0; i < lines.length - 2; i += 1) {
      if (!/^\|.*\|$/.test(lines[i]) || !/^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(lines[i + 1])) continue
      const columns = splitRow(lines[i])
      const categoryIndex = columns.findIndex((column) => /^(Status|状态|Channel|渠道|MchId|商户|Merchant|AppId|应用|Agent|代理|Store|门店)$/i.test(column))
      const measureIndex = columns.findIndex((column) => /(Amount|金额|收入|利润|数量|订单量|count|sum|value)/i.test(column))
      if (categoryIndex < 0 || measureIndex < 0 || categoryIndex === measureIndex) continue
      for (let rowIndex = i + 2; rowIndex < lines.length && /^\|.*\|$/.test(lines[rowIndex]); rowIndex += 1) {
        const cells = splitRow(lines[rowIndex])
        const value = String(cells[measureIndex] || '').replace(/,/g, '')
        if (!Number.isFinite(Number(value))) continue
        pairs.push({ category: columns[categoryIndex], measure: columns[measureIndex], dimension: cells[categoryIndex], value })
      }
    }
  }
  return pairs
}

function evidencePairMismatch(markdown, insights, files = []) {
  const lines = String(markdown || '').replace(/,/g, '').split(/\r?\n/)
  const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const containsNumber = (line, value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return false
    const candidates = [String(numeric)]
    if (Math.abs(numeric) >= 100) candidates.push(String(numeric / 100))
    return candidates.some((candidate) => new RegExp(`(^|[^0-9.])${escape(candidate)}(?![0-9.])`).test(line))
  }
  const pairs = evidencePairsFromFiles(files)
  for (const block of Array.isArray(insights) ? insights : []) {
    const category = String(block?.chart?.encode?.category || '')
    const measure = String(block?.chart?.encode?.value || '')
    if (!category || !measure || category === measure) continue
    const rows = (Array.isArray(block?.rows) ? block.rows : []).filter((row) => (
      row && typeof row === 'object'
      && (row[category] ?? row.label) != null
      && Number.isFinite(Number(row[measure] ?? row.value))
    ))
    if (rows.length < 2) continue
    for (const row of rows) {
      pairs.push({
        category,
        measure,
        dimension: String(row[category] ?? row.label),
        value: row[measure] ?? row.value,
      })
    }
  }
  const uniquePairs = pairs.filter((pair, index) => pair.dimension
    && pairs.findIndex((candidate) => candidate.category === pair.category
      && candidate.measure === pair.measure && candidate.dimension === pair.dimension
      && String(candidate.value) === String(pair.value)) === index)
  for (const pair of uniquePairs) {
    const categoryPattern = /^status$/i.test(pair.category) ? '(?:Status|状态)' : escape(pair.category)
    const qualifiedMention = new RegExp(`${categoryPattern}\\s*(?:=|:|：)?\\s*${escape(pair.dimension)}(?![0-9A-Za-z_])`, 'i')
    const semanticMention = /[\p{L}\p{Script=Han}]/u.test(pair.dimension)
      ? (line) => line.includes(pair.dimension)
      : () => false
    for (const line of lines.filter((candidate) => qualifiedMention.test(candidate) || semanticMention(candidate))) {
      if (containsNumber(line, pair.value)) continue
      const conflicting = uniquePairs.find((other) => other !== pair && containsNumber(line, other.value))
      if (conflicting) {
        const canonical = uniquePairs.slice(0, 12)
          .map((item) => `${item.category}=${item.dimension} → ${item.measure}=${item.value}`)
          .join('; ')
        return `${pair.category}=${pair.dimension} is paired with another row's ${pair.measure}; expected ${pair.value} (or its exact unit conversion), not ${conflicting.value}. Canonical evidence rows: ${canonical}`
      }
    }
  }
  return ''
}

export function validateAuthoredReportQuality(markdown, files, insights = []) {
  const text = String(markdown || '')
  const normalizedText = text.replace(/,/g, '')
  const plainLen = text.replace(/[#*_`\s|:-]/g, '').length
  if (plainLen < 160) {
    return { ok: false, error: 'final report is too thin — rewrite it as a complete business report with findings, evidence tables, numbers and caveats from every analysis file' }
  }
  const h2 = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim())
  const contentH2 = h2.filter((title) => !/^目录$/.test(title))
  const firstH2 = contentH2[0] || ''
  if (!/(摘要|核心结论|核心发现|主要发现|Executive Summary)/i.test(firstH2)) {
    return {
      ok: false,
      error: 'final report chapters are not user-readable. Rewrite with a JoyAgent-style business report outline: 1) 报告摘要/核心结论 first, 2) 核心发现, 3) 分主题分析, 4) 结论与建议, 5) 数据口径与证据附录. Do not put task-file mapping, data boundaries, or evidence-file tables before the summary.',
    }
  }
  const early = text.slice(0, 1200)
  if (/(^|\n)##\s*(报告说明|分析过程|数据口径|数据边界|证据|任务文件|口径说明)/.test(early)
    || /任务\s*\|.*证据文件|证据文件\s*\|.*任务|task\d+.*\.md/i.test(early)) {
    return {
      ok: false,
      error: 'final report starts with engineering evidence/lineage instead of business conclusions. Move task mapping, data口径, boundary notes and evidence tables to an appendix after the recommendations; first page must explain the business result in plain language.',
    }
  }
  if (!h2.some((title) => /(结论|建议|行动|风险|机会)/.test(title))) {
    return {
      ok: false,
      error: 'final report needs a conclusion/recommendation chapter for business users, not only evidence tables. Add “结论与建议” before the appendix.',
    }
  }
  if (!h2.some((title) => /(附录|口径|证据|方法)/.test(title))) {
    return {
      ok: false,
      error: 'final report must keep evidence traceability, but place it at the end as “附录：数据口径与证据”.',
    }
  }
  const limitationFiles = (Array.isArray(files) ? files : []).filter((file) => file?.limitationOnly)
  if (limitationFiles.length && !/(分析限制|报告限制|局限|未完成|未覆盖|预算)/.test(text)) {
    return {
      ok: false,
      error: 'final report must disclose unfinished budget-limited tasks. Add an “分析限制” section that names the uncovered topics and explains the impact; do not present the partial report as complete.',
    }
  }
  const requiredEntityTokens = extractReportEvidenceTokens(files)
  const includedEntities = requiredEntityTokens.filter((token) => text.includes(token))
  const requiredEntityCount = Math.min(3, requiredEntityTokens.length)
  if (includedEntities.length < requiredEntityCount) {
    return {
      ok: false,
      error: `final report needs traceable top-entity evidence: include at least ${requiredEntityCount} actual IDs/names from the analysis files (for example: ${requiredEntityTokens.slice(0, requiredEntityCount).join(', ')}). Long-tail entities may stay in the appendix file and do not all need to be repeated.`,
    }
  }
  if (requiredEntityTokens.length && !/(MchId|商户ID|商户)/.test(text)) {
    return { ok: false, error: 'final report must include merchant/entity analysis because the analysis files contain merchant evidence' }
  }
  const numericTokens = extractReportNumericEvidenceTokens(files)
    .filter((token) => !requiredEntityTokens.includes(token))
  if (numericTokens.length >= 3) {
    const included = numericTokens.filter((token) => reportIncludesNumericEvidence(normalizedText, token))
    const required = Math.min(3, Math.ceil(numericTokens.length * 0.35))
    if (included.length < required) {
      return {
        ok: false,
        error: `final report is too generic and lost numeric evidence from analysis files. Include concrete values/ratios from the evidence tables (for example: ${numericTokens.slice(0, 6).join(', ')}), not only qualitative wording.`,
      }
    }
  }
  const pairMismatch = evidencePairMismatch(text, insights, files)
  if (pairMismatch) {
    return {
      ok: false,
      error: `final report has a dimension/value evidence mismatch: ${pairMismatch}. Correct the row mapping from the analysis evidence before retrying.`,
    }
  }
  return { ok: true }
}

/** JoyAgent report_tool downloads every product file before invoking its report model. */
export function runReadAnalysisFiles(_args = {}, opts = {}) {
  const session = sessionOf(opts)
  const plan = session.analysisPlan
  if (!plan?.tasks?.length) return { ok: false, error: 'call od_analysis_plan first' }
  const limitationFiles = materializeBudgetLimitationFiles(session)
  if (session.analysisFiles.length < plan.tasks.length) {
    return { ok: false, error: `analysis task files incomplete (${session.analysisFiles.length}/${plan.tasks.length})` }
  }
  return toLosslessJson({
    ok: true,
    reportTitle: plan.title,
    fileCount: session.analysisFiles.length,
    files: session.analysisFiles.map((file) => ({
      fileName: file.name,
      description: file.name,
      content: file.content,
      limitationOnly: Boolean(file.limitationOnly),
    })),
    partial: limitationFiles.length > 0 || session.analysisFiles.some((file) => file.limitationOnly),
    disclosure: session.analysisFiles.some((file) => file.limitationOnly)
      ? '部分分析任务因预算限制未取得可验证证据；最终报告必须保留“分析限制”章节。'
      : '',
  })
}

export function runCompleteAnalysisTask(args, opts = {}) {
  const session = sessionOf(opts)
  const plan = session.analysisPlan
  if (!plan?.tasks?.length) return { ok: false, error: 'call od_analysis_plan first' }
  const index = Number.isFinite(Number(args.taskIndex)) ? Number(args.taskIndex) : Number(session.meta.analysisTaskIndex || 0)
  const task = plan.tasks[index]
  if (!task) return { ok: false, error: `unknown taskIndex ${index}` }
  if (['completed', 'skipped'].includes(task.status)) {
    const existing = session.analysisFiles.find((file) => Number(file.taskIndex) === index)
    if (existing) {
      return toLosslessJson({
        ok: true,
        alreadyComplete: true,
        partial: Boolean(existing.limitationOnly),
        skipped: Boolean(existing.limitationOnly),
        taskIndex: index,
        title: task.title,
        filename: existing.name,
        file: existing,
        completedCount: session.analysisFiles.length,
        totalTasks: plan.tasks.length,
        note: '该任务文件已经生成；无需重复完成，请继续下一任务。',
      })
    }
  }
  const acquired = acquireReportTask(session, index)
  if (!acquired.ok) return acquired
  const insights = ensureInsights(session)
  const savedBlocks = insights.filter((block) => Number(block.taskIndex || 0) === index)
  const savedHandles = new Set(savedBlocks.map((block) => block.handle))
  const evidenceOnly = evidenceBlocksForTask(session, index).filter((block) => !savedHandles.has(block.handle))
  if (evidenceOnly.length) insights.push(...evidenceOnly)
  let blocks = [...savedBlocks, ...evidenceOnly]
  if (!blocks.length) {
    blocks = []
  }
  if (!blocks.length) {
    const created = materializeBudgetLimitationFiles(session)
    const limitationFile = created.find((file) => Number(file.taskIndex) === index)
      || session.analysisFiles.find((file) => Number(file.taskIndex) === index && file.limitationOnly)
    if (limitationFile) {
      return toLosslessJson({
        ok: true,
        partial: true,
        skipped: true,
        taskIndex: index,
        title: task.title,
        filename: limitationFile.name,
        file: limitationFile,
        completedCount: session.analysisFiles.length,
        totalTasks: plan.tasks.length,
        note: '该任务因预算限制生成了限制说明文件；继续下一任务，最终报告必须披露此缺口。',
      })
    }
    return { ok: false, error: 'this analysis task has no saved insight' }
  }
  const content = taskFileMarkdown(task, blocks, args.summary)
  const filename = String(args.filename || `analysis-task-${index + 1}.md`)
  const file = { name: filename, type: 'markdown', content, size: Buffer.byteLength(content, 'utf8'), taskIndex: index, taskId: task.id }
  session.analysisFiles.push(file)
  task.status = 'completed'
  const next = plan.tasks.find((candidate) => candidate.status === 'not_started'
    && (candidate.dependsOn || []).every((id) => plan.tasks.some((item) => item.id === id && ['completed', 'skipped'].includes(item.status))))
  session.meta.analysisTaskIndex = next ? plan.tasks.indexOf(next) : plan.tasks.length
  completeAnalysisPlanTask(index, file, { key: session.key })
  return toLosslessJson({
    ok: true,
    taskIndex: index,
    title: task.title,
    filename,
    file,
    completedCount: session.analysisFiles.length,
    totalTasks: plan.tasks.length,
    note: next ? `Continue task ${index + 1}: ${next.title}` : 'All analysis task files are ready. Call od_commit_report with the authored final markdown.',
  })
}

export function runCommitReport(args, opts = {}) {
  const session = sessionOf(opts)
  if (session.meta?.completedReport?.ok) {
    return toLosslessJson({ ...session.meta.completedReport, alreadyCommitted: true,
      note: 'Report was already committed successfully. Reuse this result; do not submit again.' })
  }
  const insights = ensureInsights(session)
  if (!insights.length) {
    return { ok: false, error: 'no insights saved — od_get_data then od_save_insight at least once' }
  }
  const plan = session.analysisPlan
  if (plan?.tasks?.length) materializeBudgetLimitationFiles(session)
  if (plan?.tasks?.length && session.analysisFiles.length < plan.tasks.length) {
    return { ok: false, error: `analysis task files incomplete (${session.analysisFiles.length}/${plan.tasks.length})` }
  }
  const title = String(args.title || session.meta.title || session.meta.message || '分析报告')
  const format = String(args.format || 'html').toLowerCase() === 'markdown' ? 'markdown' : 'html'
  const authored = String(args.markdown || args.content || '').trim()
  if (plan?.tasks?.length && !authored) {
    return { ok: false, error: 'final authored markdown is required after analysis planning' }
  }
  if (plan?.tasks?.length) {
    const quality = validateAuthoredReportQuality(authored, session.analysisFiles, insights)
    if (!quality.ok) return quality
  }
  const rendered = authored ? renderAuthoredReport({ title, markdown: authored }) : renderReport({
    title,
    summary: '',
    insights,
    frames: insights.map((b) => ({
      handle: b.handle,
      title: b.title,
      process: b.process,
      suggestedChartType: b.suggestedChartType,
      rowCount: b.rowCount,
      rows: b.rows,
      chart: b.chart,
      fields: b.fields,
    })),
  })
  const filename = String(args.filename || (format === 'markdown' ? 'analysis-report.md' : 'analysis-report.html'))
  const evidence = reportEvidence(session, insights)
  const result = toLosslessJson({
    ok: true,
    title: rendered.title,
    format,
    filename,
    html: rendered.html,
    markdown: rendered.markdown,
    analysisFiles: Array.isArray(session.analysisFiles) ? session.analysisFiles : [],
    evidence,
    claims: reportClaims(rendered.markdown, evidence),
    insightCount: insights.length,
    dashboardId: null,
    source: 'analysis-worker',
    note: 'Static snapshot report. Not a refreshable dashboard.',
  })
  const meta = reportPresentationMeta(result)
  rememberPresentation(meta, session.key)
  const liveKey = boardSessionKey()
  if (liveKey !== session.key) rememberPresentation(meta, liveKey)
  return result
}

export async function executeReportCommit(args, opts = {}) {
  const session = sessionOf(opts)
  const remote = session.meta?.reportRunId ? {
    runId: session.meta.reportRunId,
    conversationId: session.meta.reportConversationId,
  } : null
  const result = toLosslessJson(runCommitReport(args, { session }))
  if (result.ok && remote) {
    const publish = opts.publishRemote || publishRemoteReportResult
    result.authority = await publish(remote, result, session)
  }
  if (remote) {
    setReportAuthority({
      ...remote,
      status: result.authority?.status || (result.ok ? 'quality_check' : 'needs_action'),
    }, { key: session.key })
  }
  // A quality failure is repairable. Keep the exact plan, evidence frames and
  // analysis files so the report agent can revise Markdown and retry. Clearing
  // here made every first-pass quality issue unrecoverable.
  if (result.ok) {
    session.meta.completedReport = result
    deactivateAnalysisSession(session.key)
  }
  return result
}

function toolMeta(name) {
  return {
    presentCall: (args) => ({
      card: 'generic',
      title: `${name} · ${args.title || args.handle || args.datasetId || args.analysisMethod || ''}`,
      kind: name === 'od_commit_report' ? 'write' : 'search',
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: name,
      content: result.content,
    }),
  }
}

export function registerAnalysisWorkerTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'od_analysis_plan',
    description:
      'ANALYSIS WORKER ONLY. JoyAgent PlanningAgent analogue. Call exactly once after od_get_schema. '
      + 'Create dynamic, non-overlapping analysis subtasks from the user request and actual schema; do not use a fixed report template. '
      + 'Each task must include task and businessKnowledge. The final report stage is added by the harness.',
    parameters: {
      reportTitle: { type: 'string', required: true },
      tasks: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string', required: true },
            task: { type: 'string', required: true },
            businessKnowledge: { type: 'string', required: true },
            dependsOn: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first' },
            budget: { type: 'object', additionalProperties: true },
          },
        },
      },
      budget: { type: 'object', additionalProperties: true, description: 'Report execution limits such as maxTasks, concurrency, maxQueries, maxPythonCalls, maxRows and timeouts' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok ? `analysis plan: ${value.taskCount} tasks` : `analysis plan failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_analysis_plan'),
    execute(args) {
      return trackAnalysisTool('od_analysis_plan', args, async () => {
        const session = sessionForNewAnalysisPlan(getBoardSession())
        return persistAnalysisPlan(args, runAnalysisPlan(args, { session }), session)
      }, { force: true })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_wait_report_approval',
    description: 'ANALYSIS WORKER ONLY. After od_analysis_plan, wait until the user confirms the exact plan version in Open Dashboard. Execution must not start before this succeeds.',
    parameters: { timeoutMs: { type: 'integer', description: 'Maximum wait, defaults to 300000 ms' } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: value.ok ? 'report plan approved' : `approval wait failed: ${value.error || value.status}` }],
    },
    ...toolMeta('od_wait_report_approval'),
    execute(args) {
      return trackAnalysisTool('od_wait_report_approval', args, () => waitReportApproval(args), { force: true })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_python',
    description:
      'ANALYSIS WORKER ONLY. Run Python on cached od_get_data frames (JoyAgent interpreter). '
      + 'rows is ALWAYS available; df is only available when pandas is installed. '
      + 'Never probe builtins/imports/runtime and never retry a failed Python call. '
      + 'Do not invent DataFrames. Do not conclude from df.head() when rowCount>5. '
      + 'Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', description: 'get_data handle; omit to expose all frames' },
      code: { type: 'string', required: true, description: 'Python. Use df / rows / print. Set result= for a return value.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `python ok${value.handle ? ` ${value.handle}` : ''}${value.stdout ? `\n${value.stdout}` : ''}`
          : `python failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_python'),
    async execute(args) {
      return trackAnalysisTool(
        'od_python',
        args,
        async () => {
          const required = planRequired()
          if (required) return required
          const budget = consumeReportBudget(getBoardSession(), 'python')
          return budget.ok ? toLosslessJson(await runAnalysisPython(args)) : budget
        },
        { force: true },
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_insight',
    description:
      'ANALYSIS WORKER ONLY. Run one JoyAgent insight method on a get_data handle. '
      + `analysis_method: ${INSIGHT_METHODS.join(' | ')}. `
      + 'Omit method to scan all gated methods. Empty insights mean 无分析结论 — do not retry other methods for the same evidence; complete the task with an evidence-only file. '
      + 'Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', required: true },
      analysisMethod: { type: 'string', description: INSIGHT_METHODS.join('|') },
      breakdown: { type: 'string' },
      measure: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `insight ${value.handle}${value.analysisMethod ? `/${value.analysisMethod}` : ''}: ${(value.insights || []).length} items → ${value.suggestedChartType || 'none'}${value.note ? `\n${value.note}` : ''}`
          : `insight failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_insight'),
    execute(args) {
      return trackAnalysisTool(
        'od_insight',
        args,
        () => planRequired() || toLosslessJson(runInsight(args)),
        { force: true },
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_save_insight',
    description:
      'ANALYSIS WORKER ONLY. Stage a useful conclusion + snapshot rows. Not a dashboard chart. '
      + 'Do not save 无分析结论. Multiple conclusions = multiple calls. Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', required: true },
      title: { type: 'string' },
      process: { type: 'string', description: 'Short analysis process note' },
      insight: { type: 'string', description: 'Agent-written conclusion(s); split multiple with <sep>' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `saved insight ${value.title} (${value.savedCount} staged)`
          : `save_insight failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_save_insight'),
    execute(args) {
      return trackAnalysisTool(
        'od_save_insight',
        args,
        () => planRequired() || toLosslessJson(runSaveInsight(args)),
        { force: true },
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_complete_analysis_task',
    description:
      'ANALYSIS WORKER ONLY. JoyAgent data_analysis final_answer analogue. '
      + 'After the planned evidence queries finish, create its independent Markdown analysis file. Saved insights are optional when usable aggregate frames exist. '
      + 'Call once per task in plan order. If query budget is exhausted, do not retry: this tool creates a limitation file when no evidence is available. '
      + 'Do not call od_commit_report before every task file exists.',
    parameters: {
      taskIndex: { type: 'integer', required: true, description: 'Zero-based task index from od_analysis_plan' },
      title: { type: 'string' },
      summary: { type: 'string', required: true, description: 'Evidence-backed summary for this subtask only' },
      filename: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok ? `analysis file ready: ${value.filename}` : `analysis task failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_complete_analysis_task'),
    execute(args) {
      return trackAnalysisTool(
        'od_complete_analysis_task',
        args,
        () => runCompleteAnalysisTask(args),
        { force: true },
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_read_analysis_files',
    description:
      'REPORT GENERATOR ONLY. JoyAgent report_tool file download analogue. '
      + 'After data_analysis stops, read ALL independent Markdown files in full before authoring the final report. '
      + 'Budget-limited unfinished tasks are materialized as limitation files instead of blocking delivery. '
      + 'Use the files as evidence, disclose every limitation, and do not copy their task/lineage structure into the opening chapters.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok ? `loaded ${value.fileCount} analysis files` : `read analysis files failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_read_analysis_files'),
    execute(args) {
      return trackAnalysisTool(
        'od_read_analysis_files',
        args,
        () => runReadAnalysisFiles(args),
        { force: true },
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_commit_report',
    description:
      'ANALYSIS WORKER ONLY. JoyAgent report_tool analogue. Read all completed analysis task files and author one final report. '
      + 'Call after od_read_analysis_files. markdown/content must be a complete evidence-backed Chinese report, not a fixed template. '
      + 'If the quality gate returns a repair instruction, revise the Markdown and call again; the plan and evidence remain available until commit succeeds. '
      + 'If any input file is limitationOnly, add an explicit “分析限制” section and never invent conclusions for uncovered topics. '
      + 'The chapter order must be readable for business users: 报告摘要/核心结论 first, then 核心发现, 分主题分析, 结论与建议, and finally 附录：数据口径与证据. '
      + 'Do not put 报告说明、任务文件映射、数据边界、证据表 at the beginning; move those to the appendix. '
      + 'The harness only renders the authored Markdown to static HTML/MD and never invents sections. Conversation lead must not call this.',
    parameters: {
      title: { type: 'string' },
      markdown: { type: 'string', description: 'Complete authored final report in Markdown' },
      content: { type: 'string', description: 'Alias of markdown' },
      format: { type: 'string', description: 'html | markdown' },
      filename: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `report ready: ${value.filename} (${value.insightCount} insights)`
          : `commit_report failed: ${value.error || 'unknown'}`,
      }],
      presentationMeta(_args, value) {
        return reportPresentationMeta(value)
      },
    },
    ...toolMeta('od_commit_report'),
    execute(args) {
      return trackAnalysisTool(
        'od_commit_report',
        args,
        async () => executeReportCommit(args),
        { force: true },
      )
    },
  }))
}
