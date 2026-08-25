/**
 * Eval runner — load cases, run stages, aggregate report.
 */
import path from 'node:path'
import { listCaseFiles, loadCase } from './load-case.js'
import { STAGE_RUNNERS } from './stages.js'

/**
 * @param {{
 *   track?: string,
 *   stages?: string[],
 *   id?: string,
 *   casesDir?: string,
 * }} opts
 */
export async function runEval(opts = {}) {
  const files = listCaseFiles(opts.casesDir)
  const stageFilter = opts.stages?.length
    ? new Set(opts.stages.map((s) => String(s).toLowerCase()))
    : null
  const trackFilter = opts.track ? String(opts.track).toLowerCase() : null
  const idFilter = opts.id ? String(opts.id) : null

  const results = []
  for (const file of files) {
    const caseCtx = loadCase(file)
    const doc = caseCtx.doc
    const id = doc.id || path.basename(file, '.json')
    const track = String(doc.track || '').toLowerCase()
    const stage = String(doc.stage || '').toLowerCase()

    if (idFilter && id !== idFilter) continue
    if (trackFilter && track !== trackFilter) continue
    if (stageFilter && !stageFilter.has(stage)) continue

    const runner = STAGE_RUNNERS[stage]
    if (!runner) {
      results.push({
        id,
        track,
        stage,
        file,
        ok: false,
        reason: `unknown stage: ${stage}`,
        ms: 0,
      })
      continue
    }

    const t0 = Date.now()
    let outcome
    try {
      outcome = await Promise.resolve(runner(caseCtx))
    } catch (err) {
      outcome = { ok: false, reason: String(err?.message || err), actual: {} }
    }
    results.push({
      id,
      track,
      stage,
      file,
      ok: !!outcome.ok,
      reason: outcome.reason || '',
      actual: outcome.actual,
      ms: Date.now() - t0,
      pr: doc.pr || null,
    })
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  return {
    ok: failed.length === 0 && results.length > 0,
    total: results.length,
    passed,
    failed: failed.length,
    results,
    byStage: summarizeBy(results, 'stage'),
    byTrack: summarizeBy(results, 'track'),
  }
}

function summarizeBy(results, key) {
  const map = {}
  for (const r of results) {
    const k = r[key] || '?'
    if (!map[k]) map[k] = { total: 0, passed: 0, failed: 0 }
    map[k].total += 1
    if (r.ok) map[k].passed += 1
    else map[k].failed += 1
  }
  return map
}

export function formatReport(report) {
  const lines = [
    `od-eval: ${report.passed}/${report.total} passed`
      + (report.failed ? ` · ${report.failed} failed` : ''),
  ]
  for (const [stage, s] of Object.entries(report.byStage || {})) {
    lines.push(`  stage ${stage}: ${s.passed}/${s.total}`)
  }
  for (const r of report.results.filter((x) => !x.ok)) {
    lines.push(`  FAIL ${r.id} [${r.track}/${r.stage}] ${r.reason}`)
  }
  return lines.join('\n')
}
