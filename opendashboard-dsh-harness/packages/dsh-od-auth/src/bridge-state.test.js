import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BRIDGE,
  ensureDefaultIdentity,
  getBridge,
  loadBridgeFromEnv,
  mergeClientBridge,
  setBridge,
} from './bridge-state.js'

describe('bridge-state identity', () => {
  beforeEach(() => {
    setBridge({})
    delete process.env.OD_DSH_BRIDGE
  })

  it('fills demo tenant when nothing is bound', () => {
    const next = ensureDefaultIdentity()
    assert.equal(next.userId, DEFAULT_BRIDGE.userId)
    assert.equal(next.workspaceId, DEFAULT_BRIDGE.workspaceId)
    assert.equal(next.perms, DEFAULT_BRIDGE.perms)
  })

  it('empty iframe POST does not wipe env bootstrap', () => {
    setBridge({ userId: 'demo', workspaceId: 'workspace-retail', perms: '*' })
    const next = mergeClientBridge({ userId: '', workspaceId: '', perms: '' })
    assert.equal(next.userId, 'demo')
    assert.equal(next.workspaceId, 'workspace-retail')
    assert.equal(next.perms, '*')
  })

  it('logged-in principal replaces the demo tenant', () => {
    setBridge({ userId: 'demo', workspaceId: 'workspace-retail', perms: '*' })
    const next = mergeClientBridge({ userId: 'u2', workspaceId: 'ws-sales', perms: 'dataset:use' })
    assert.equal(next.userId, 'u2')
    assert.equal(next.workspaceId, 'ws-sales')
    assert.equal(next.perms, 'dataset:use')
  })

  it('loadBridgeFromEnv still defaults when env is unset', () => {
    const next = loadBridgeFromEnv()
    assert.equal(next.userId, 'demo')
    assert.equal(getBridge().workspaceId, 'workspace-retail')
  })
})
