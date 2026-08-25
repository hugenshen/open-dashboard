import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  displaySessionTitle,
  isOpaqueSessionId,
  questionPreview,
  sessionHasHumanMessage,
} from './session-list-title.js'

function userText(text, seq = 1) {
  return {
    type: 'user/message',
    seq,
    time: seq * 1000,
    data: {
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    },
  }
}

function pluginText(text, seq = 1) {
  return {
    type: 'user/message',
    seq,
    time: seq * 1000,
    data: {
      source: { kind: 'plugin', plugin: 'od-auth' },
      content: [{ type: 'text', text }],
    },
  }
}

describe('displaySessionTitle', () => {
  it('uses the first human question, not session- id prefix', () => {
    const title = displaySessionTitle([
      pluginText('DataQ workspace context…'),
      userText('/board 用订单数据做专业经营仪表盘', 2),
    ])
    assert.equal(title, '用订单数据做专业经营仪表盘')
    assert.equal(isOpaqueSessionId('session-'), true)
    assert.equal(isOpaqueSessionId(title), false)
  })

  it('prefers a folded title when it is not an id', () => {
    assert.equal(
      displaySessionTitle([userText('/board 很长的原话')], '生成订单经营仪表盘'),
      '生成订单经营仪表盘',
    )
  })

  it('ignores plugin-only logs as blank 新会话', () => {
    assert.equal(sessionHasHumanMessage([pluginText('internal')]), false)
    assert.equal(displaySessionTitle([pluginText('internal')]), '新会话')
  })

  it('never returns session- when there is a human message', () => {
    const title = displaySessionTitle([userText('华东本月 GMV 同比？')])
    assert.match(title, /GMV/)
    assert.equal(title.startsWith('session-'), false)
  })
})

describe('questionPreview', () => {
  it('strips slash commands', () => {
    assert.equal(questionPreview('/ask 支付成功订单数'), '支付成功订单数')
    assert.equal(questionPreview('/report'), '/report')
  })
})
