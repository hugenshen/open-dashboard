import test from 'node:test'
import assert from 'node:assert/strict'
import { acquireReportTask, consumeReportBudget, initializeReportExecution } from './report-execution.js'

test('report execution enforces dependencies, concurrency and budgets', () => {
  const session = { meta: {}, analysisPlan: { tasks: [
    { id: 'a', dependsOn: [], status: 'not_started' },
    { id: 'b', dependsOn: [], status: 'not_started' },
    { id: 'c', dependsOn: ['a'], status: 'not_started' },
    { id: 'd', dependsOn: [], status: 'not_started' },
  ] } }
  initializeReportExecution(session, { concurrency: 2, maxQueries: 2, maxPythonCalls: 1, totalTimeoutSeconds: 30 })
  assert.equal(acquireReportTask(session, 0).ok, true)
  assert.equal(acquireReportTask(session, 1).ok, true)
  assert.match(acquireReportTask(session, 3).error, /CONCURRENCY_LIMIT/)
  assert.match(acquireReportTask(session, 2).error, /DEPENDENCY_PENDING/)
  session.analysisPlan.tasks[0].status = 'completed'
  assert.equal(acquireReportTask(session, 2).ok, true)
  session.analysisPlan.tasks[1].status = 'completed'
  assert.equal(consumeReportBudget(session, 'query').ok, true)
  assert.equal(consumeReportBudget(session, 'query').ok, true)
  assert.match(consumeReportBudget(session, 'query').error, /maxQueries/)
  assert.equal(consumeReportBudget(session, 'python').ok, true)
  assert.match(consumeReportBudget(session, 'python').error, /maxPythonCalls/)
})

test('one task cannot consume the query budget reserved for the whole report', () => {
  const session = { meta: { analysisTaskIndex: 0 }, analysisPlan: { tasks: [
    { id: 'a', dependsOn: [], status: 'in_progress', budget: {} },
    { id: 'b', dependsOn: [], status: 'not_started', budget: {} },
  ] } }
  initializeReportExecution(session, { maxQueries: 16, maxPythonCalls: 4 })
  for (let i = 0; i < 4; i += 1) assert.equal(consumeReportBudget(session, 'query').ok, true)
  const limited = consumeReportBudget(session, 'query')
  assert.equal(limited.ok, false)
  assert.equal(limited.scope, 'task')
  assert.match(limited.error, /REPORT_TASK_BUDGET_EXCEEDED:maxQueries:4/)
  assert.match(limited.recovery, /下一任务/)
  assert.equal(session.meta.reportUsage.queries, 4)

  session.meta.analysisTaskIndex = 1
  assert.equal(consumeReportBudget(session, 'query').ok, true)
  assert.equal(session.meta.reportUsage.queries, 5)
})

test('report-level exhaustion is recorded for partial-delivery recovery', () => {
  const session = { meta: { analysisTaskIndex: 0 }, analysisPlan: { tasks: [
    { id: 'a', dependsOn: [], status: 'in_progress', budget: { maxQueries: 10 } },
  ] } }
  initializeReportExecution(session, { maxQueries: 1 })
  assert.equal(consumeReportBudget(session, 'query').ok, true)
  const exhausted = consumeReportBudget(session, 'query')
  assert.equal(exhausted.scope, 'report')
  assert.match(exhausted.error, /REPORT_BUDGET_EXCEEDED:maxQueries:1/)
  assert.equal(session.meta.reportBudgetExhaustion.kind, 'query')
  assert.equal(session.meta.reportBudgetLimitations.length, 1)
})
