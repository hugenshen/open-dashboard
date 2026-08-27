/**
 * In-process analysis-report progress (JoyAgent ActionPanel analogue).
 * Spawn workers do not forward subCalls to the parent session, so the Vue
 * right pane cannot read child od_get_data / od_python / od_insight from
 * runningCalls. Tools write here; iframe polls GET /od/report-progress.
 * @module @opendashboard/dsh-od-bi/report-progress
 */

import { boardSessionKey, getBoardSession } from './board-store.js'

const LAST = '__last__'
const runs = new Map()
let seq = 0

export const REPORT_NODE_META = Object.freeze({
  od_analysis_plan: { title: '规划分析任务', category: 'PlanningAgent' },
  od_get_data: { title: '读取并核对数据', category: '数据读取' },
  od_data_trans: { title: '计算占比、排名或变化', category: '数据处理' },
  od_python: { title: 'Python 代码分析', category: '代码分析' },
  od_insight: { title: '识别趋势与归因', category: '分析推理' },
  od_save_insight: { title: '保存分析结论', category: '证据固化' },
  od_complete_analysis_task: { title: '生成子任务分析文件', category: 'data_analysis' },
  od_read_analysis_files: { title: '读取全部分析文件', category: 'report_tool' },
  od_commit_report: { title: '生成分析报告', category: '产物生成' },
})

function compact(value, max = 480) {
  if (value == null || value === '') return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const clean = String(text).replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function liveKeys(explicit) {
  const k = explicit || boardSessionKey()
  return k === LAST ? [LAST] : [k, LAST]
}

function emptyRun(title = '分析报告') {
  const now = Date.now()
  const label = String(title || '分析报告')
  return {
    title: label,
    status: 'running',
    startedAt: now,
    steps: [],
    plan: {
      stages: ['规划分析任务'],
      stepStatus: ['in_progress'],
      steps: [`正在根据「${label}」与数据集 schema 拆解任务`],
      taskIds: ['planning'],
    },
    files: [],
    thoughts: [{
      id: 't-start',
      kind: 'thought',
      title: '思考过程',
      body: `已接收到你的任务，将立即开始处理「${label}」。`,
      md: `已接收到你的任务，将立即开始处理「${label}」。`,
      at: now,
    }],
  }
}

function normalizePlanTask(task, index) {
  const title = String(task?.title || task?.task || `分析任务 ${index + 1}`).trim()
  return {
    id: String(task?.id || `analysis-${index + 1}`),
    title,
    task: String(task?.task || title),
    businessKnowledge: String(task?.businessKnowledge || task?.business_knowledge || ''),
  }
}

/** JoyAgent PlanningAgent analogue: the PlanView is independent from tool/action nodes. */
export function setAnalysisPlan(input = {}, opts = {}) {
  const run = ensureReportRun({ key: opts.key, title: input.reportTitle || input.title })
  const tasks = (Array.isArray(input.tasks) ? input.tasks : []).map(normalizePlanTask)
  if (!tasks.length) return { ok: false, error: 'analysis plan requires at least one task' }
  const stages = [...tasks.map((task) => task.title), '生成汇总报告']
  run.plan = {
    stages,
    stepStatus: stages.map((_, index) => index === 0 ? 'in_progress' : 'not_started'),
    steps: [...tasks.map((task) => task.task), '读取所有子任务文件，生成 HTML / Markdown 报告'],
    taskIds: [...tasks.map((task) => task.id), 'report'],
  }
  if (input.reportTitle || input.title) run.title = String(input.reportTitle || input.title)
  writeRun(run, opts.key)
  return { ok: true, taskCount: tasks.length, plan: run.plan }
}

/** Mark one data_analysis subtask complete and expose its intermediate product file. */
export function completeAnalysisPlanTask(index, file, opts = {}) {
  const run = getRun(opts.key)
  if (!run?.plan) return
  const taskIndex = Math.max(0, Number(index || 0))
  if (taskIndex < run.plan.stepStatus.length - 1) {
    run.plan.stepStatus[taskIndex] = 'completed'
    const next = Math.min(taskIndex + 1, run.plan.stepStatus.length - 1)
    if (run.plan.stepStatus[next] === 'not_started') run.plan.stepStatus[next] = 'in_progress'
  }
  if (file?.name && !run.files.some((item) => item.name === file.name)) {
    run.files.push({
      name: String(file.name),
      type: String(file.type || 'text'),
      content: String(file.content || ''),
      size: Number(file.size || Buffer.byteLength(String(file.content || ''), 'utf8')),
    })
  }
  writeRun(run, opts.key)
}

function writeRun(run, key) {
  for (const k of liveKeys(key)) runs.set(k, run)
  return run
}

function getRun(key) {
  const k = key || boardSessionKey()
  return runs.get(k) || runs.get(LAST) || null
}

export function resetReportProgress(key) {
  if (arguments.length === 0) {
    runs.clear()
    seq = 0
    return
  }
  runs.delete(key)
  if (key !== LAST) runs.delete(LAST)
}

export function ensureReportRun(opts = {}) {
  const key = opts.key || boardSessionKey()
  const existing = getRun(key)
  if (existing && existing.status === 'running') {
    if (opts.title && existing.title === '分析报告') existing.title = String(opts.title)
    writeRun(existing, key)
    return existing
  }
  return writeRun(emptyRun(opts.title || existing?.title || '分析报告'), key)
}

function pushThought(run, thought) {
  run.thoughts.push({
    id: thought.id || `t-${++seq}`,
    kind: thought.kind || 'thought',
    title: thought.title || '',
    body: thought.body || '',
    code: thought.code || '',
    md: thought.md || thought.body || '',
    at: Date.now(),
  })
  if (run.thoughts.length > 40) run.thoughts.splice(0, run.thoughts.length - 40)
}

function stepInputs(name, args) {
  const fields = name === 'od_analysis_plan'
    ? [['报告标题', args.reportTitle || args.title], ['分析任务', Array.isArray(args.tasks) ? args.tasks.map((task) => task.title || task.task).join('；') : '']]
    : name === 'od_get_data'
    ? [['数据集', args.datasetId], ['业务问题', args.question || args.message], ['维度', args.dim], ['指标', args.measure], ['聚合', args.agg]]
    : name === 'od_data_trans'
      ? [['数据句柄', args.handle], ['转换方式', args.transType || args.trans_type], ['分组列', args.column], ['指标', args.measure]]
      : name === 'od_python'
        ? [['数据句柄', args.handle]]
        : name === 'od_insight'
          ? [['数据句柄', args.handle], ['方法', args.analysisMethod || args.analysis_method], ['拆解维度', args.breakdown], ['分析指标', args.measure]]
          : name === 'od_save_insight'
            ? [['数据句柄', args.handle], ['洞察标题', args.title], ['分析说明', args.process]]
            : name === 'od_complete_analysis_task'
              ? [['任务序号', args.taskIndex], ['任务标题', args.title], ['任务总结', args.summary]]
            : [['报告标题', args.title], ['文件名', args.filename], ['格式', args.format]]
  return fields
    .filter(([, value]) => value != null && value !== '')
    .map(([label, value]) => ({ label, value: compact(value, 240) }))
}

function stepDetail(name, args) {
  if (name === 'od_analysis_plan') return args.reportTitle || args.title || '动态拆解分析任务'
  if (name === 'od_get_data') return args.question || args.message || [args.dim, args.measure].filter(Boolean).join(' · ')
  if (name === 'od_data_trans') return [args.transType || args.trans_type, args.measure].filter(Boolean).join(' · ')
  if (name === 'od_python') return String(args.code || '').split('\n').find((line) => line.trim()) || args.handle || ''
  if (name === 'od_insight') {
    return [args.analysisMethod || args.analysis_method, args.breakdown, args.measure].filter(Boolean).join(' · ')
  }
  if (name === 'od_save_insight') return args.title || args.process || ''
  if (name === 'od_complete_analysis_task') return args.title || args.summary || ''
  if (name === 'od_commit_report') return args.title || args.filename || ''
  return ''
}

function beginThought(name, args) {
  if (name === 'od_analysis_plan') {
    return {
      kind: 'thought',
      title: '规划',
      body: '正在根据问题、schema 和业务知识拆解分析任务。',
      md: '**规划** 正在动态拆解分析任务。',
    }
  }
  if (name === 'od_get_data') {
    const q = args.question || args.message || [args.dim, args.measure].filter(Boolean).join(' / ') || '聚合切片'
    return {
      kind: 'data',
      title: '取数',
      body: `正在读取数据：${q}`,
      md: `**取数** 正在读取「${q}」。`,
    }
  }
  if (name === 'od_python') {
    const code = String(args.code || '').trim()
    return {
      kind: 'code',
      title: 'Python',
      body: '正在运行 Python 分析。',
      code,
      md: `**Python** 正在运行代码分析。\n\n\`\`\`python\n${code.slice(0, 1200)}\n\`\`\``,
    }
  }
  if (name === 'od_data_trans') {
    return {
      kind: 'data',
      title: '变换',
      body: `正在计算 ${args.transType || args.trans_type || '变换'}。`,
      md: `**变换** 正在计算 \`${args.transType || args.trans_type || ''}\`。`,
    }
  }
  if (name === 'od_insight') {
    const method = args.analysisMethod || args.analysis_method || '全部门控方法'
    return {
      kind: 'insight',
      title: '洞察',
      body: `正在用 ${method} 方法识别显著结论。`,
      md: `**思考** 正在用 \`${method}\` 做形态/显著性门控，不合格的不输出。`,
    }
  }
  if (name === 'od_save_insight') {
    return {
      kind: 'save',
      title: '保存',
      body: `正在保存洞察「${args.title || '结论'}」。`,
      md: `**保存** 「${args.title || '结论'}」。`,
    }
  }
  if (name === 'od_complete_analysis_task') {
    return {
      kind: 'save',
      title: '子任务成稿',
      body: `正在生成「${args.title || '分析任务'}」的独立分析文件。`,
      md: `**data_analysis** 正在固化「${args.title || '分析任务'}」的分析结果。`,
    }
  }
  return {
    kind: 'commit',
    title: '成稿',
    body: '正在渲染 HTML / Markdown 分析报告。',
    md: '**成稿** 正在生成静态分析报告。',
  }
}

function finishOutput(name, result) {
  if (!result || result.ok === false) return compact(result?.error || 'failed', 480)
  if (name === 'od_get_data') {
    return `${result.rowCount || 0} 行 → ${result.suggestedChartType || 'none'}${result.detailDump ? '（明细 dump，需换维）' : ''}`
  }
  if (name === 'od_python') {
    const bits = [result.stdout, result.result != null ? JSON.stringify(result.result) : '']
      .filter((s) => String(s || '').trim())
    return compact(bits.join('\n') || 'python ok', 800)
  }
  if (name === 'od_data_trans') return `${result.derivedColumn || ''} · ${result.rowCount || 0} 行`
  if (name === 'od_insight') {
    const items = Array.isArray(result.insights) ? result.insights : []
    if (!items.length) return result.note || '无分析结论'
    return items.map((it) => it.text || it.type).filter(Boolean).join('；')
  }
  if (name === 'od_save_insight') return `已暂存 ${result.savedCount || 0} 条 · ${result.title || ''}`
  if (name === 'od_analysis_plan') return `已规划 ${result.taskCount || 0} 个分析任务`
  if (name === 'od_complete_analysis_task') return result.filename || '子任务文件已生成'
  if (name === 'od_commit_report') return result.filename || 'report ready'
  return compact(result.note || 'ok', 480)
}

function finishThought(name, result) {
  if (!result || result.ok === false) {
    return {
      kind: 'thought',
      title: '失败',
      body: String(result?.error || '步骤失败'),
      md: `**失败** ${compact(result?.error || '步骤失败', 360)}`,
    }
  }
  if (name === 'od_get_data') {
    return {
      kind: 'data',
      title: '取数完成',
      body: `取到 ${result.rowCount || 0} 行聚合结果。`,
      md: `**取数完成** ${result.rowCount || 0} 行，建议图种 \`${result.suggestedChartType || 'none'}\`。`,
    }
  }
  if (name === 'od_python') {
    const out = compact(result.stdout || '', 600)
    return {
      kind: 'code',
      title: 'Python 输出',
      body: out || 'python ok',
      md: out ? `**Python 输出**\n\n\`\`\`\n${out}\n\`\`\`` : '**Python** 执行完成。',
    }
  }
  if (name === 'od_insight') {
    const items = Array.isArray(result.insights) ? result.insights : []
    if (!items.length) {
      return {
        kind: 'insight',
        title: '无结论',
        body: '该方法未过门控，不保存。',
        md: '**洞察** 无分析结论 — 换维或换方法。',
      }
    }
    const lines = items.map((it) => `- ${it.text || it.type}`).join('\n')
    return {
      kind: 'insight',
      title: '洞察',
      body: items.map((it) => it.text).filter(Boolean).join('；'),
      md: `**洞察** \`${result.analysisMethod || ''}\`\n\n${lines}`,
    }
  }
  if (name === 'od_save_insight') {
    return {
      kind: 'save',
      title: '已保存',
      body: `已暂存「${result.title || '结论'}」。`,
      md: `**已保存** 「${result.title || '结论'}」（共 ${result.savedCount || 0} 条）。`,
    }
  }
  if (name === 'od_analysis_plan') {
    return {
      kind: 'thought',
      title: '规划完成',
      body: `已拆解 ${result.taskCount || 0} 个分析任务。`,
      md: `**规划完成** 已拆解 ${result.taskCount || 0} 个分析任务，将逐个执行并生成文件。`,
    }
  }
  if (name === 'od_complete_analysis_task') {
    return {
      kind: 'save',
      title: '分析文件已生成',
      body: result.filename || '子任务分析文件已生成。',
      md: `**文件** ${result.filename || '子任务分析文件'} 已生成。`,
    }
  }
  if (name === 'od_commit_report') {
    return {
      kind: 'commit',
      title: '报告已生成',
      body: result.filename || 'report ready',
      md: `**成稿** ${result.filename || '分析报告已生成'}。`,
    }
  }
  return {
    kind: 'data',
    title: '完成',
    body: finishOutput(name, result),
    md: `**完成** ${finishOutput(name, result)}`,
  }
}

export function beginReportStep(name, args = {}, opts = {}) {
  const run = ensureReportRun({ key: opts.key, title: opts.title })
  const meta = REPORT_NODE_META[name] || { title: name, category: '工具调用' }
  const id = `${name}-${++seq}`
  const next = {
    id,
    nodeName: name,
    category: meta.category,
    title: meta.title,
    detail: stepDetail(name, args) || meta.title,
    status: 'running',
    depth: name === 'od_board_worker' ? 0 : 1,
    startedAt: Date.now(),
    durationMs: 0,
    inputs: stepInputs(name, args),
    output: '',
    code: name === 'od_python' ? String(args.code || '') : '',
    attemptCount: 1,
  }
  run.steps.push(next)
  pushThought(run, beginThought(name, args))
  writeRun(run, opts.key)
  return id
}

export function finishReportStep(id, result, opts = {}) {
  const run = getRun(opts.key)
  if (!run) return
  const step = run.steps.find((s) => s.id === id)
  const name = step?.nodeName || ''
  if (step) {
    const ok = result && result.ok !== false
    step.status = ok ? 'done' : 'error'
    step.durationMs = Math.max(0, Date.now() - Number(step.startedAt || Date.now()))
    step.output = finishOutput(name, result)
  }
  pushThought(run, finishThought(name, result))
  writeRun(run, opts.key)
}

export function finishReportRun(opts = {}) {
  const run = getRun(opts.key)
  if (!run) return
  const now = Date.now()
  for (const step of run.steps) {
    if (step.status === 'running') {
      step.status = opts.status === 'error' ? 'error' : 'done'
      step.durationMs = Math.max(0, now - Number(step.startedAt || now))
    }
  }
  run.status = opts.status === 'error' ? 'error' : 'done'
  if (run.plan?.stepStatus?.length) {
    const last = run.plan.stepStatus.length - 1
    run.plan.stepStatus[last] = opts.status === 'error' ? 'error' : 'completed'
  }
  writeRun(run, opts.key)
}

export function snapshotReportProgress(key) {
  const run = getRun(key)
  if (!run) {
    return {
      status: 'idle',
      title: '',
      startedAt: 0,
      activeNode: '',
      steps: [],
      thoughts: [],
      narrative: '',
      plan: { stages: [], stepStatus: [], steps: [] },
      files: [],
      tick: 0,
    }
  }
  const now = Date.now()
  const steps = run.steps.map((step) => ({
    ...step,
    durationMs: step.status === 'running'
      ? Math.max(0, now - Number(step.startedAt || now))
      : Number(step.durationMs || 0),
  }))
  const current = [...steps].reverse().find((step) => (
    step.status === 'running'
  ))
  return {
    title: run.title,
    status: run.status,
    startedAt: Number(run.startedAt || 0),
    activeNode: current?.title || '',
    steps,
    thoughts: run.thoughts,
    narrative: run.thoughts.map((t) => t.md).filter(Boolean).join('\n\n'),
    plan: run.plan || { stages: [], stepStatus: [], steps: [], taskIds: [] },
    files: Array.isArray(run.files) ? run.files : [],
    tick: run.status === 'running' ? now : Number(run.startedAt || 0),
  }
}

export function isAnalysisTrack(args = {}) {
  if (String(args.purpose || '').toLowerCase() === 'analysis') return true
  try {
    return getBoardSession().meta?.purpose === 'analysis'
  } catch {
    return false
  }
}

/**
 * Wrap an analysis tool execute(). Board-path get_data/data_trans skip this.
 */
export async function trackAnalysisTool(name, args, fn, opts = {}) {
  const force = opts.force === true
  if (!force && !isAnalysisTrack(args)) return fn()
  const title = opts.title
    || args.title
    || args.question
    || args.message
    || '分析报告'
  const key = opts.key || getBoardSession().key
  const id = beginReportStep(name, args || {}, { title, key })
  try {
    const result = await fn()
    finishReportStep(id, result, { key })
    if (name === 'od_commit_report') {
      finishReportRun({ key, status: result?.ok === false ? 'error' : 'done' })
    }
    return result
  } catch (err) {
    finishReportStep(id, { ok: false, error: String(err?.message || err) }, { key })
    if (name === 'od_commit_report') finishReportRun({ key, status: 'error' })
    throw err
  }
}

export function registerReportProgressRoute(webServer) {
  if (!webServer) return
  const sendJson = (res, status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end(JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
  webServer.register({
    kind: 'exact',
    path: '/od/report-progress',
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
        sendJson(res, 200, { ok: true, progress: snapshotReportProgress() })
        return
      }
      if (req.method === 'POST') {
        try {
          const raw = await readBody(req)
          const parsed = raw ? JSON.parse(raw) : {}
          if (parsed.action === 'reset') {
            resetReportProgress()
          } else if (parsed.action === 'begin') {
            ensureReportRun({ title: parsed.title || '分析报告' })
          }
          sendJson(res, 200, { ok: true, progress: snapshotReportProgress() })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: String(err?.message || err) })
        }
        return
      }
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  })
}
