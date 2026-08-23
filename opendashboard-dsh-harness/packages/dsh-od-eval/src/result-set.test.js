import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compareResultSets, fingerprintRows, normalizeCell } from './result-set.js'

describe('result-set EX', () => {
  it('ignores column order and row order', () => {
    const gold = [{ a: 1, b: 2 }, { a: 3, b: 4 }]
    const pred = [{ b: 4, a: 3 }, { b: 2, a: 1 }]
    assert.equal(compareResultSets(pred, gold).ok, true)
  })

  it('detects value mismatch', () => {
    assert.equal(compareResultSets([{ a: 1 }], [{ a: 2 }]).ok, false)
  })

  it('normalizes numeric strings', () => {
    assert.equal(normalizeCell('1.0'), 1)
    assert.deepEqual(fingerprintRows([{ x: '2' }]), fingerprintRows([{ x: 2 }]))
  })
})
