/**
 * Load eval case JSON + resolve fixture fields.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const EVAL_ROOT = path.resolve(__dirname, '..')
export const CASES_DIR = path.join(EVAL_ROOT, 'cases')
export const FIXTURES_DIR = path.join(EVAL_ROOT, 'fixtures')

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function resolveFields(caseDoc) {
  const ds = caseDoc.dataset || {}
  if (Array.isArray(ds.fields) && ds.fields.length) return ds.fields
  if (ds.fixture) {
    const fp = path.isAbsolute(ds.fixture)
      ? ds.fixture
      : path.join(FIXTURES_DIR, ds.fixture)
    const data = loadJson(fp)
    return Array.isArray(data) ? data : (data.fields || [])
  }
  return []
}

/** Recursively list *.json under cases/ */
export function listCaseFiles(root = CASES_DIR) {
  const out = []
  if (!fs.existsSync(root)) return out
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) walk(full)
      else if (name.endsWith('.json')) out.push(full)
    }
  }
  walk(root)
  return out.sort()
}

export function loadCase(filePath) {
  const doc = loadJson(filePath)
  return {
    filePath,
    doc,
    fields: resolveFields(doc),
  }
}
