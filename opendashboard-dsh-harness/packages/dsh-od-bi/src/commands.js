/**
 * OD slash commands for BI conversation (/datasets, /ask, /board, /report).
 * Chat follow-up is human-readable; routing lives in persona + od_* tool descriptions.
 * @module @opendashboard/dsh-od-bi/commands
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { getBridge } from '@opendashboard/dsh-od-auth/bridge-state'

function lockedDatasetHint(opts = {}) {
  return Boolean(opts.datasetId && String(opts.datasetId).trim())
}

/** User-visible /report line. Protocol is NOT in this string (PR-ANR-01 runtime still in tools). */
export function buildReportFollowup(rawInput = '', opts = {}) {
  const q = String(rawInput || '').trim()
  const locked = lockedDatasetHint(opts)
  if (!q) {
    return locked
      ? '我想写分析报告。请用当前已选的数据集，等我提出具体解读问题后再生成。'
      : '我想写分析报告。请先帮我确认数据集，等我提出具体解读问题后再生成。'
  }
  return `写一份分析报告：${q}`
}

/** User-visible /board line. HITL / spawn rules stay on od_plan_charts and od_board_worker. */
export function buildBoardFollowup(rawInput = '', opts = {}) {
  const theme = String(rawInput || '').trim()
  const locked = lockedDatasetHint(opts)
  if (!theme) {
    return locked
      ? '帮我生成一张仪表盘。请用当前已选的数据集；若已有草稿就在同一张上改。'
      : '帮我生成一张仪表盘。若已有草稿就在同一张上改，没有就先给出规划等我确认。'
  }
  return `生成仪表盘：${theme}`
}

/** User-visible /ask line. Query path stays on od_run_query / od_run_sql descriptions. */
export function buildAskFollowup(rawInput = '', opts = {}) {
  const q = String(rawInput || '').trim()
  const locked = lockedDatasetHint(opts)
  if (!q) {
    return locked
      ? '我想问数。请用当前已选的数据集，等我提出具体指标或维度问题。结果直接显示在对话里。'
      : '我想问数。请先确认可用数据，等我提出具体指标或维度问题。结果直接显示在对话里。'
  }
  return q
}

export function buildDatasetsFollowup() {
  return '列出我当前可以问的数据集。'
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerOdCommands(ctx) {
  const submit = (agent, text) => {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }))
  }

  ctx.commands.register({
    name: 'datasets',
    description: '看看有哪些数据可以问',
    handler: ({ agent }) => {
      submit(agent, buildDatasetsFollowup())
      return { kind: 'success', text: '已发起：列出可问数据集' }
    },
  })

  ctx.commands.register({
    name: 'ask',
    description: '问一个数据问题，结果出在对话里',
    input: { hint: '[你的数据问题]' },
    handler: ({ agent, rawInput }) => {
      const q = rawInput.trim()
      submit(agent, buildAskFollowup(q, { datasetId: getBridge().datasetId }))
      return { kind: 'success', text: q ? '已发起问数' : '已进入问数模式' }
    },
  })

  ctx.commands.register({
    name: 'board',
    description: '生成一张可编辑的仪表盘',
    input: { hint: '[看板主题，可选]' },
    handler: ({ agent, rawInput }) => {
      const theme = rawInput.trim()
      submit(agent, buildBoardFollowup(theme, { datasetId: getBridge().datasetId }))
      return { kind: 'success', text: '已发起：生成仪表盘' }
    },
  })

  ctx.commands.register({
    name: 'report',
    description: '写一份分析报告，完成后在右侧打开',
    input: { hint: '[分析问题，可选]' },
    handler: ({ agent, rawInput }) => {
      const q = rawInput.trim()
      submit(agent, buildReportFollowup(q, { datasetId: getBridge().datasetId }))
      return { kind: 'success', text: q ? '已发起：分析报告' : '已进入分析报告模式' }
    },
  })
}
