import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  beginReportStep,
  ensureReportRun,
  finishReportRun,
  finishReportStep,
  completeAnalysisPlanTask,
  resetReportProgress,
  setAnalysisPlan,
  setReportAuthority,
  snapshotReportProgress,
  trackAnalysisTool,
} from './report-progress.js'

describe('report-progress (PR-ANR-02 live nodes)', () => {
  beforeEach(() => {
    process.env.OD_REPORT_PROGRESS_FILE = path.join(os.tmpdir(), `od-report-progress-test-${process.pid}.json`)
    resetReportProgress()
  })

  it('grows nodes as get_data / python / insight finish', async () => {
    ensureReportRun({ title: '写分析报告', key: 'test-progress' })
    const getId = beginReportStep('od_get_data', {
      datasetId: 'ds1',
      question: '订单状态构成',
      dim: 'Status',
      measure: 'Amt',
    }, { key: 'test-progress', title: '写分析报告' })
    finishReportStep(getId, { ok: true, rowCount: 4, suggestedChartType: 'pie' }, { key: 'test-progress' })
    await trackAnalysisTool(
      'od_python',
      { handle: 'h1', code: 'print(df.describe())' },
      async () => ({ ok: true, stdout: 'count 4' }),
      { force: true, key: 'test-progress', title: '写分析报告' },
    )
    const snap = snapshotReportProgress('test-progress')
    const names = snap.steps.map((s) => s.nodeName)
    assert.ok(names.includes('od_get_data'))
    assert.ok(names.includes('od_python'))
    assert.equal(snap.status, 'running')
    assert.match(snap.narrative, /取数/)
    assert.match(snap.narrative, /Python/)
    assert.ok(snap.thoughts.some((t) => t.kind === 'code'))
  })

  it('keeps the dynamic plan independent from tool/action nodes', () => {
    ensureReportRun({ title: '写分析报告', key: 'adv-plan' })
    setAnalysisPlan({ reportTitle: '订单报告', tasks: [
      { title: '状态异常', task: '检查状态异常', businessKnowledge: '状态枚举以 schema 为准' },
      { title: '商户归因', task: '定位商户差异', businessKnowledge: '商户是经营主体' },
    ] }, { key: 'adv-plan' })
    beginReportStep('od_get_data', { question: '订单状态构成' }, { key: 'adv-plan', title: '写分析报告' })
    const snap = snapshotReportProgress('adv-plan')
    assert.equal(snap.steps.length, 1)
    assert.equal(snap.steps[0].taskIndex, 0)
    assert.deepEqual(snap.plan.stages, ['状态异常', '商户归因', '生成汇总报告'])
    assert.equal(snap.plan.stepStatus[0], 'in_progress')
    assert.equal(snap.activeNode, '读取并核对数据')
  })

  it('does not let stale report keys overwrite the active visible snapshot', () => {
    setAnalysisPlan({ reportTitle: '当前订单报告', tasks: [
      { title: '商户贡献', task: '分析商户贡献', businessKnowledge: '保留真实商户 ID' },
    ] }, { key: 'current-report' })
    const staleId = beginReportStep('od_get_data', {
      datasetId: 'ds_ops',
      question: '旧运营日报趋势',
      dim: 'day',
      measure: 'pv',
    }, { key: 'stale-report', title: '旧运营日报' })
    finishReportStep(staleId, { ok: true, rowCount: 4, suggestedChartType: 'line' }, { key: 'stale-report' })

    const visible = snapshotReportProgress()
    assert.equal(visible.title, '当前订单报告')
    assert.deepEqual(visible.plan.stages, ['商户贡献', '生成汇总报告'])
    assert.equal(visible.steps.some((step) => step.inputs?.some((input) => input.value === 'ds_ops')), false)
    assert.equal(snapshotReportProgress('stale-report').steps.length, 1)
  })

  it('skips board-path get_data', async () => {
    const result = await trackAnalysisTool(
      'od_get_data',
      { purpose: 'board', datasetId: 'ds1' },
      async () => ({ ok: true, rowCount: 2 }),
    )
    assert.equal(result.rowCount, 2)
    assert.equal(snapshotReportProgress().status, 'idle')
  })

  it('starts with a planning placeholder, then exposes task files as subtasks finish', () => {
    ensureReportRun({ title: '写分析报告', key: 'seed-plan' })
    let snap = snapshotReportProgress('seed-plan')
    assert.equal(snap.steps.length, 0)
    assert.deepEqual(snap.plan.stages, ['规划分析任务'])
    setAnalysisPlan({ tasks: [
      { title: '任务 A', task: '分析 A', businessKnowledge: '口径 A' },
      { title: '任务 B', task: '分析 B', businessKnowledge: '口径 B' },
    ] }, { key: 'seed-plan' })
    completeAnalysisPlanTask(0, { name: 'analysis-task-1.md', content: '# A' }, { key: 'seed-plan' })
    snap = snapshotReportProgress('seed-plan')
    assert.deepEqual(snap.plan.stepStatus, ['completed', 'in_progress', 'not_started'])
    assert.equal(snap.files[0].name, 'analysis-task-1.md')
  })

  it('marks the run done on commit', async () => {
    await trackAnalysisTool(
      'od_commit_report',
      { title: '订单报告' },
      async () => ({
        ok: true,
        title: '订单报告',
        filename: 'order.html',
        html: '<h1>订单报告</h1>',
        markdown: '# 订单报告',
      }),
      { force: true },
    )
    const snap = snapshotReportProgress()
    assert.equal(snap.status, 'done')
    assert.ok(snap.steps.every((s) => s.status !== 'running'))
    assert.equal(snap.steps[0].taskIndex, 0)
    assert.ok(snap.files.some((file) => file.name === 'order.html' && file.final && file.content.includes('<h1>')))
    assert.ok(snap.files.some((file) => file.name === 'order.md' && file.final && file.content.includes('# 订单报告')))
  })

  it('turns empty/failing data steps into user-actionable states', () => {
    ensureReportRun({ title: '写分析报告', key: 'actionable' })
    const emptyId = beginReportStep('od_get_data', {
      datasetId: 'ds_orders',
      question: '最近一天订单异常',
      dim: 'merchant_id',
      measure: 'amount',
    }, { key: 'actionable', title: '写分析报告' })
    finishReportStep(emptyId, {
      ok: true,
      rowCount: 0,
      suggestedChartType: null,
      note: '没有取到可用于分析的数据。',
    }, { key: 'actionable' })
    const failedId = beginReportStep('od_get_data', {
      datasetId: 'ds_orders',
      question: '订单表',
      measure: 'amount',
    }, { key: 'actionable', title: '写分析报告' })
    finishReportStep(failedId, {
      ok: false,
      error: 'fetch failed',
    }, { key: 'actionable' })
    const snap = snapshotReportProgress('actionable')
    assert.equal(snap.steps[0].status, 'needs_action')
    assert.match(snap.steps[0].output, /没有取到可用于分析的数据/)
    assert.match(snap.steps[0].recovery, /放宽时间范围/)
    assert.equal(snap.steps[1].status, 'error')
    assert.match(snap.steps[1].output, /数据服务暂时不可用/)
    assert.match(snap.narrative, /建议/)
  })

  it('turns python budget failures into a reportable next action', () => {
    ensureReportRun({ title: '写分析报告', key: 'py-budget' })
    const id = beginReportStep('od_python', {
      handle: 'h1',
      code: 'print(df.describe())',
    }, { key: 'py-budget', title: '写分析报告' })
    finishReportStep(id, {
      ok: false,
      error: '代码分析预算已用完',
      note: '请改用已经取得的聚合证据保存洞察并生成子任务文件。',
    }, { key: 'py-budget' })
    const snap = snapshotReportProgress('py-budget')
    assert.equal(snap.steps[0].status, 'error')
    assert.match(snap.steps[0].output, /代码分析预算已用完/)
    assert.match(snap.steps[0].recovery, /已有洞察|聚合证据/)
  })

  it('exposes startedAt so the shell can ignore a dismissed run', () => {
    ensureReportRun({ title: '写分析报告', key: 'id-run' })
    const snap = snapshotReportProgress('id-run')
    assert.equal(typeof snap.startedAt, 'number')
    assert.ok(snap.startedAt > 0)
    assert.equal(snap.status, 'running')
  })

  it('exposes the Java authority id and approval state for the report workspace', () => {
    ensureReportRun({ title: '写分析报告', key: 'authority-run' })
    setReportAuthority({ runId: '901', conversationId: '8', planVersion: 2, status: 'awaiting_plan_approval' }, { key: 'authority-run' })
    const snap = snapshotReportProgress('authority-run')
    assert.equal(snap.reportRunId, '901')
    assert.equal(snap.conversationId, '8')
    assert.equal(snap.planVersion, 2)
    assert.equal(snap.authorityStatus, 'awaiting_plan_approval')
  })

  it('reset drops LAST so a later snapshot is idle', () => {
    ensureReportRun({ title: '旧报告' })
    assert.equal(snapshotReportProgress().status, 'running')
    resetReportProgress()
    const snap = snapshotReportProgress()
    assert.equal(snap.status, 'idle')
    assert.equal(snap.startedAt, 0)
  })

  it('replays the latest report progress from persisted snapshot after memory loss', async () => {
    await trackAnalysisTool(
      'od_commit_report',
      { title: '订单报告' },
      async () => ({
        ok: true,
        title: '订单报告',
        filename: 'order.html',
        html: '<h1>订单报告</h1>',
        markdown: '# 订单报告\n\n包含商户 M10004 与金额 570000。',
      }),
      { force: true, key: 'persisted-run' },
    )
    assert.equal(snapshotReportProgress('persisted-run').status, 'done')
    const persisted = JSON.parse(fs.readFileSync(process.env.OD_REPORT_PROGRESS_FILE, 'utf8'))
    resetReportProgress()
    fs.writeFileSync(process.env.OD_REPORT_PROGRESS_FILE, JSON.stringify(persisted), 'utf8')
    const snap = snapshotReportProgress('fresh-process')
    assert.equal(snap.status, 'done')
    assert.ok(snap.files.some((file) => file.name === 'order.html' && file.content.includes('<h1>')))
    assert.match(snap.narrative, /报告|生成/)
  })
})
