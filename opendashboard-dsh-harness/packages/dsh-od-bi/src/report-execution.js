const defaults = Object.freeze({ maxTasks: 4, concurrency: 2, maxQueries: 16, maxPythonCalls: 4, maxRows: 200, queryTimeoutSeconds: 15, totalTimeoutSeconds: 900 })
const taskDefaults = Object.freeze({ maxQueries: 4, maxPythonCalls: 1 })

export function initializeReportExecution(session, budget = {}) {
  const normalized = { ...defaults, ...budget }
  for (const key of Object.keys(defaults)) normalized[key] = Math.max(0, Number(normalized[key] ?? defaults[key]))
  session.meta ||= {}
  session.meta.reportBudget = normalized
  session.meta.reportUsage = { queries: 0, pythonCalls: 0, byTask: {}, startedAt: Date.now() }
  session.meta.reportBudgetLimitations = []
  return normalized
}

export function acquireReportTask(session, taskIndex) {
  const plan = session.analysisPlan
  if (!plan?.tasks?.length) return { ok: false, error: 'REPORT_PLAN_REQUIRED' }
  const index = Number.isFinite(Number(taskIndex)) ? Number(taskIndex) : Number(session.meta?.analysisTaskIndex || 0)
  const task = plan.tasks[index]
  if (!task) return { ok: false, error: `UNKNOWN_REPORT_TASK:${index}` }
  if (['completed', 'skipped'].includes(task.status)) {
    return { ok: false, taskComplete: true, taskIndex: index, error: `REPORT_TASK_ALREADY_COMPLETE:${index}`,
      recovery: '不要重新打开已完成任务；继续执行计划中的下一个待执行任务。' }
  }
  const completed = new Set(plan.tasks.filter((item) => ['completed', 'skipped'].includes(item.status)).map((item) => item.id))
  const missing = (task.dependsOn || []).filter((id) => !completed.has(id))
  if (missing.length) return { ok: false, error: `REPORT_TASK_DEPENDENCY_PENDING:${missing.join(',')}` }
  if (task.status !== 'in_progress') {
    const running = plan.tasks.filter((item) => item.status === 'in_progress').length
    const concurrency = Number(session.meta?.reportBudget?.concurrency || defaults.concurrency)
    if (running >= concurrency) return { ok: false, error: `REPORT_CONCURRENCY_LIMIT:${concurrency}` }
    task.status = 'in_progress'
  }
  return { ok: true, taskIndex: index, task }
}

export function consumeReportBudget(session, kind) {
  session.meta ||= {}
  if (!session.meta.reportBudget || !session.meta.reportUsage) initializeReportExecution(session)
  const budget = session.meta.reportBudget
  const usage = session.meta.reportUsage
  usage.byTask ||= {}
  const taskIndex = Number.isFinite(Number(session.meta?.analysisTaskIndex)) ? Number(session.meta.analysisTaskIndex) : 0
  const task = session.analysisPlan?.tasks?.[taskIndex]
  const taskUsage = usage.byTask[taskIndex] ||= { queries: 0, pythonCalls: 0 }
  if (Date.now() - usage.startedAt > budget.totalTimeoutSeconds * 1000) {
    return recordExhaustion(session, exhausted('totalTimeoutSeconds', budget.totalTimeoutSeconds), {
      scope: 'report', kind: 'time', taskIndex,
    })
  }
  if (kind === 'query') {
    const taskLimit = Math.max(1, Number(task?.budget?.maxQueries ?? taskDefaults.maxQueries))
    if (taskUsage.queries >= taskLimit) {
      return recordExhaustion(session, exhausted('maxQueries', taskLimit, 'task'), {
        scope: 'task', kind, taskIndex,
      })
    }
    if (usage.queries >= budget.maxQueries) {
      return recordExhaustion(session, exhausted('maxQueries', budget.maxQueries), {
        scope: 'report', kind, taskIndex,
      })
    }
    usage.queries += 1
    taskUsage.queries += 1
  }
  if (kind === 'python') {
    const taskLimit = Math.max(0, Number(task?.budget?.maxPythonCalls ?? taskDefaults.maxPythonCalls))
    if (taskUsage.pythonCalls >= taskLimit) {
      return recordExhaustion(session, exhausted('maxPythonCalls', taskLimit, 'task'), {
        scope: 'task', kind, taskIndex,
      })
    }
    if (usage.pythonCalls >= budget.maxPythonCalls) {
      return recordExhaustion(session, exhausted('maxPythonCalls', budget.maxPythonCalls), {
        scope: 'report', kind, taskIndex,
      })
    }
    usage.pythonCalls += 1
    taskUsage.pythonCalls += 1
  }
  return { ok: true, budget, usage: { ...usage } }
}

function exhausted(name, limit, scope = 'report') {
  const prefix = scope === 'task' ? 'REPORT_TASK_BUDGET_EXCEEDED' : 'REPORT_BUDGET_EXCEEDED'
  const subject = scope === 'task' ? '当前子任务' : '本轮报告'
  return { ok: false, needsAction: true, error: `${prefix}:${name}:${limit}`,
    disclosure: `${subject}已达到 ${name}=${limit} 的预算上限；不要重复调用，可使用已有证据完成该任务，或在最终报告中披露未覆盖内容。` }
}

function recordExhaustion(session, result, limitation) {
  const item = { ...limitation, error: result.error, disclosure: result.disclosure, at: Date.now() }
  const list = session.meta.reportBudgetLimitations ||= []
  const duplicate = list.some((entry) => entry.scope === item.scope && entry.kind === item.kind && entry.taskIndex === item.taskIndex)
  if (!duplicate) list.push(item)
  if (item.scope === 'report') session.meta.reportBudgetExhaustion = item
  return { ...result, scope: item.scope, taskIndex: item.taskIndex,
    recovery: item.scope === 'task'
      ? '停止重试当前步骤；保存已有洞察并继续下一任务。若没有可用证据，读取分析文件时会自动生成限制说明。'
      : '停止继续取数；读取分析文件并生成带“分析限制”章节的部分报告。' }
}

export { defaults as REPORT_BUDGET_DEFAULTS, taskDefaults as REPORT_TASK_BUDGET_DEFAULTS }
