/**
 * Analysis-worker Python interpreter (JoyAgent PythonInterpreterTool analogue).
 * Only runs against cached get_data frames. No filesystem / network tools.
 * @module @opendashboard/dsh-od-bi/analysis-python
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getBoardSession, getFrame } from './board-store.js'

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'analysis-python-runner.py')
const TIMEOUT_MS = 10_000
const MAX_CODE = 20_000
const MAX_ROWS = 200

function sessionOf(opts) {
  return opts.session || getBoardSession()
}

function rowsOf(frame) {
  const rows = Array.isArray(frame?.rows) ? frame.rows.slice(0, MAX_ROWS) : []
  return rows.map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) return { ...row }
    if (Array.isArray(row)) {
      const out = {}
      row.forEach((v, i) => { out[i === 0 ? 'label' : i === 1 ? 'value' : `c${i}`] = v })
      return out
    }
    return { value: row }
  })
}

function pythonBin() {
  return process.env.OD_PYTHON || 'python3'
}

export function runPythonSyncCheck(code) {
  const src = String(code || '')
  if (!src.trim()) return 'code required'
  if (src.length > MAX_CODE) return `code exceeds ${MAX_CODE} chars`
  if (/\b(subprocess|socket|ctypes|multiprocessing)\b/.test(src)
    || /\bos\.system\b/.test(src)
    || /\b__import__\s*\(/.test(src)) {
    return 'forbidden import or syscall'
  }
  return ''
}

function spawnPython(payload) {
  return new Promise((resolve) => {
    const child = spawn(pythonBin(), ['-I', RUNNER], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already exited */ }
    }, TIMEOUT_MS)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (buf) => { stdout += buf.toString('utf8') })
    child.stderr.on('data', (buf) => { stderr += buf.toString('utf8') })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        error: `python3 unavailable: ${err.message}. Install python3 (pandas/numpy/scipy optional) or use od_insight / od_data_trans.`,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!stdout.trim()) {
        resolve({
          ok: false,
          error: stderr.trim() || `python exited ${code}`,
        })
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        resolve({ ok: false, error: 'python runner returned non-JSON', stdout: stdout.slice(0, 1000) })
      }
    })
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

/**
 * @param {{ handle?: string, code: string }} args
 */
export async function runAnalysisPython(args, opts = {}) {
  const blocked = runPythonSyncCheck(args.code)
  if (blocked) return { ok: false, error: blocked }
  const session = sessionOf(opts)
  const handle = String(args.handle || '')
  const frames = {}
  if (handle) {
    const frame = getFrame(session, handle)
    if (!frame) return { ok: false, error: 'unknown handle — call od_get_data first' }
    frames[handle] = rowsOf(frame)
  } else {
    for (const [key, frame] of session.frames.entries()) {
      frames[key] = rowsOf(frame)
    }
    if (!Object.keys(frames).length) {
      return { ok: false, error: 'no frames — call od_get_data first' }
    }
  }
  const used = Number(session.meta?.analysisPythonCalls || 0)
  if (used >= 2) {
    return {
      ok: false,
      error: '代码分析预算已用完',
      note: '本轮 Python 分析次数已达到上限。请改用已经取得的聚合证据保存洞察并生成子任务文件；如需更深分析，可新开一轮或减少分析任务数。',
    }
  }
  session.meta.analysisPythonCalls = used + 1
  const usedHandle = handle || Object.keys(frames)[0]
  const out = await spawnPython({
    code: String(args.code),
    frames,
    handle: usedHandle,
  })
  if (!out?.ok) {
    return {
      ok: false,
      error: out?.error || 'python failed',
      stdout: out?.stdout || '',
      note: 'Keep using od_data_trans / od_insight if python/pandas is missing.',
    }
  }
  return {
    ok: true,
    handle: usedHandle,
    stdout: String(out.stdout || '').slice(0, 16000),
    result: out.result ?? null,
    note: 'Python ran on cached aggregation only. rows 始终可用，df 仅在 pandas 已安装时可用。不要探测运行环境；下一步 od_insight / od_save_insight。',
  }
}
