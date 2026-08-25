/**
 * Board session key + presentation lift store.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { getBridge, setBridge } from '@opendashboard/dsh-od-auth/bridge-state'
import {
  boardSessionKey,
  consumePresentation,
  rememberPresentation,
  resetPresentation,
} from './board-store.js'

describe('boardSessionKey', () => {
  let prev
  before(() => { prev = getBridge() })
  after(() => { setBridge(prev) })

  it('stays stable after dashboardId is patched onto the bridge', () => {
    setBridge({ workspaceId: 'ws1', userId: 'u1', conversationId: '' })
    const before = boardSessionKey()
    setBridge({ workspaceId: 'ws1', userId: 'u1', conversationId: '', dashboardId: '99' })
    assert.equal(boardSessionKey(), before)
    assert.equal(boardSessionKey().endsWith(':99'), false)
  })
})

describe('remember / consume presentation', () => {
  it('explicit consume still hits the remembered key', () => {
    resetPresentation('k-child')
    rememberPresentation({
      odKind: 'board_ready',
      dashboardId: '7',
      editPath: '/dashboards/7/edit',
    }, 'k-child')
    const meta = consumePresentation('k-child')
    assert.equal(meta.odKind, 'board_ready')
    assert.equal(meta.dashboardId, '7')
    assert.equal(consumePresentation('k-child'), null)
  })
})
