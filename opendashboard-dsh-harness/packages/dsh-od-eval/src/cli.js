#!/usr/bin/env node
/**
 * od-eval CLI — P012 E0 segmented harness eval.
 * Usage: node src/cli.js [--track ask|board] [--stage plan,bind,...] [--id CASE] [--report path]
 */
import fs from 'node:fs'
import path from 'node:path'
import { runEval, formatReport } from './runner.js'

function parseArgs(argv) {
  const out = { stages: null, track: null, id: null, report: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--track') out.track = argv[++i]
    else if (a === '--stage' || a === '--stages') {
      out.stages = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    } else if (a === '--id') out.id = argv[++i]
    else if (a === '--report') out.report = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(`Usage: od-eval [--track ask|board] [--stage plan,bind,layout,guard,ex,viz] [--id ID] [--report file.json]`)
    process.exit(0)
  }
  const report = await runEval({
    track: opts.track,
    stages: opts.stages,
    id: opts.id,
  })
  console.log(formatReport(report))
  if (opts.report) {
    const abs = path.resolve(opts.report)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, JSON.stringify(report, null, 2))
    console.log(`wrote ${abs}`)
  }
  if (!report.total) {
    console.error('od-eval: no cases matched')
    process.exit(2)
  }
  process.exit(report.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
