/**
 * Read-only SQL gate (P011 M2) — port of opendashboard-harness/sqlbot/guard.py
 * without Python sqlglot. Keyword + regex first; table whitelist via FROM/JOIN scan.
 * @module @opendashboard/dsh-od-bi/sql-guard
 */

const WRITE = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
  'TRUNCATE', 'MERGE', 'COPY', 'REPLACE', 'GRANT', 'REVOKE',
  'USE', 'SET', 'CALL',
])

const DANGEROUS = [
  /\bINTO\s+OUTFILE\b/i,
  /\bLOAD_FILE\s*\(/i,
  /\bSLEEP\s*\(/i,
  /\bpg_sleep\s*\(/i,
  /;\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i,
]

function firstKeyword(sql) {
  let s = sql.trim().replace(/^\(+/, '').trim()
  if (!s) return ''
  return s.split(/\s+/, 1)[0].toUpperCase()
}

/**
 * @param {string} sql
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkSqlRead(sql) {
  let raw = String(sql || '').trim()
  if (!raw) return { ok: false, reason: 'SQL is empty' }
  if (raw.endsWith(';')) raw = raw.slice(0, -1).trim()
  if (raw.includes(';')) return { ok: false, reason: 'Multiple statements are not allowed' }
  const first = firstKeyword(raw)
  if (WRITE.has(first)) {
    return { ok: false, reason: `Write operation '${first}' is not allowed` }
  }
  for (const pattern of DANGEROUS) {
    if (pattern.test(raw)) {
      return { ok: false, reason: `SQL contains dangerous pattern: ${pattern}` }
    }
  }
  if (first !== 'SELECT' && first !== 'WITH') {
    return {
      ok: false,
      reason: `SQL command '${first}' is not allowed. Only SELECT and WITH are permitted`,
    }
  }
  return { ok: true, reason: '' }
}

/**
 * Extract physical table names from FROM/JOIN (best-effort, CTE aliases filtered loosely).
 * @param {string} sql
 * @returns {Set<string>}
 */
export function extractTables(sql) {
  const tables = new Set()
  const cte = new Set()
  if (/^\s*WITH\s+/i.test(String(sql))) {
    for (const m of String(sql).matchAll(/\b([A-Za-z_][\w$]*)\s+AS\s*\(/gi)) {
      cte.add(m[1].toLowerCase())
    }
  }
  for (const m of String(sql).matchAll(/\b(?:FROM|JOIN)\s+((?:[`"\[]?[^\s,`"\]();.]+[`"\]]?\.)*)([`"\[]?)([^\s,`"\]();]+)/gi)) {
    const name = m[3].replace(/^[`"\[]|[`"\]]$/g, '')
    if (name && !cte.has(name.toLowerCase())) tables.add(name)
  }
  return tables
}

/**
 * @param {string} sql
 * @param {Iterable<string>} allowed
 */
export function assertAllowedTables(sql, allowed) {
  const { ok, reason } = checkSqlRead(sql)
  if (!ok) throw new Error(reason)
  const actual = new Set([...extractTables(sql)].map((t) => t.toLowerCase()))
  if (!actual.size) {
    throw new Error('SQL parsing failed: unable to extract table names')
  }
  const allow = new Set([...allowed].filter(Boolean).map((t) => String(t).toLowerCase()))
  const extra = [...actual].filter((t) => !allow.has(t))
  if (extra.length) {
    throw new Error(
      `SQL contains unauthorized tables: ${extra.sort().join(', ')}. `
      + `Allowed: ${[...allow].sort().join(', ')}`,
    )
  }
}
