/**
 * sample-meta unit tests.
 * Run: node --test packages/dsh-od-bi/src/sample-meta.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveSampleMeta,
  sampleWarningForLlm,
  withSampleMeta,
} from './sample-meta.js'

describe('resolveSampleMeta', () => {
  it('parses od_sample + scaled comments', () => {
    const m = resolveSampleMeta(null, '/* od_sample est=5858015 n=50000 */ SELECT 1 /* scaled x117.160 */')
    assert.equal(m.sampled, true)
    assert.equal(m.estRows, 5858015)
    assert.equal(m.sampleN, 50000)
    assert.equal(m.scaleFactor, 117.16)
  })
  it('prefers structured extra', () => {
    const m = resolveSampleMeta({ sampled: true, sampleN: 10, estRows: 100, scaleFactor: 10 }, '')
    assert.equal(m.sampled, true)
    assert.equal(m.sampleN, 10)
  })
})

describe('withSampleMeta / warning', () => {
  it('attaches fields and warns LLM', () => {
    const v = withSampleMeta({
      ok: true,
      sqlHint: '/* od_sample est=100 n=10 */ SELECT 1 /* scaled x10.000 */',
    })
    assert.equal(v.sampled, true)
    assert.match(sampleWarningForLlm(v), /采样估算/)
  })
})
