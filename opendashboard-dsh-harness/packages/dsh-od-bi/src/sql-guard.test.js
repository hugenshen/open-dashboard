/**
 * Smoke tests for SQL read-only gate.
 * Run: node --test packages/dsh-od-bi/src/sql-guard.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertAllowedTables, checkSqlRead, extractTables } from './sql-guard.js'
import { ASK_SQL_CASES } from './quality-cases.js'

describe('checkSqlRead', () => {
  it('allows SELECT', () => {
    assert.equal(checkSqlRead('SELECT a FROM t').ok, true)
  })
  it('allows WITH', () => {
    assert.equal(checkSqlRead('WITH x AS (SELECT 1) SELECT * FROM x').ok, true)
  })
  it('rejects INSERT', () => {
    const r = checkSqlRead('INSERT INTO t VALUES (1)')
    assert.equal(r.ok, false)
  })
  it('rejects multi-statement', () => {
    assert.equal(checkSqlRead('SELECT 1; DROP TABLE t').ok, false)
  })
})

describe('assertAllowedTables', () => {
  it('accepts whitelisted table', () => {
    assert.doesNotThrow(() => assertAllowedTables('SELECT * FROM sales_detail', ['sales_detail']))
  })
  it('rejects extra table', () => {
    assert.throws(
      () => assertAllowedTables('SELECT * FROM sales_detail JOIN secret s ON 1=1', ['sales_detail']),
      /unauthorized tables/i,
    )
  })
  it('extracts simple names', () => {
    const t = extractTables('SELECT * FROM foo.bar JOIN baz')
    assert.ok(t.has('bar'))
    assert.ok(t.has('baz'))
  })
})

describe('ASK quality fixtures', () => {
  for (const c of ASK_SQL_CASES) {
    it(c.id, () => {
      const read = checkSqlRead(c.sql)
      if (!c.allow) {
        if (!read.ok) return
        assert.throws(() => assertAllowedTables(c.sql, [c.table]))
        return
      }
      assert.equal(read.ok, true)
      assert.doesNotThrow(() => assertAllowedTables(c.sql, [c.table]))
    })
  }
})
