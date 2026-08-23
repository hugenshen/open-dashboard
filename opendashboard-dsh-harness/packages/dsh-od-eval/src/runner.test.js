import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runEval } from './runner.js'

describe('od-eval runner', () => {
  it('passes default case suite', async () => {
    const report = await runEval()
    assert.ok(report.total >= 10, `expected >=10 cases, got ${report.total}`)
    assert.equal(report.failed, 0, report.results.filter((r) => !r.ok).map((r) => `${r.id}:${r.reason}`).join('; '))
    assert.equal(report.ok, true)
  })

  it('filters by track=board', async () => {
    const report = await runEval({ track: 'board' })
    assert.ok(report.total >= 4)
    assert.ok(report.results.every((r) => r.track === 'board'))
  })
})
