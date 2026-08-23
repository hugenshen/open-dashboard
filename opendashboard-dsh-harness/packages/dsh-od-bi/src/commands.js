/**
 * OD slash commands for BI conversation (/datasets, /ask, /board).
 * Menu filtering of coding commands is done in dsh-od-nodes client.
 * @module @opendashboard/dsh-od-bi/commands
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'

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
    description: '列出当前工作区可问数据集，便于选择',
    handler: ({ agent }) => {
      submit(
        agent,
        '请先调用 od_list_datasets，用简洁列表展示我当前可问的数据集（id、名称、简述）。'
          + '然后请我选择一个 datasetId，或根据名称帮我匹配。不要读本地文件。',
      )
      return { kind: 'success', text: '已发起：列出可问数据集' }
    },
  })

  ctx.commands.register({
    name: 'ask',
    description: '问数：对数据集做只读查询，表/图在对话内展示',
    input: { hint: '[你的数据问题]' },
    handler: ({ agent, rawInput }) => {
      const q = rawInput.trim()
      const text = q
        ? `请按问数路径回答（od_list_datasets → od_get_schema → od_run_query 或受控 od_run_sql → od_finish）。`
          + `od_get_schema 的 semantic.metrics 是已确认口径：点名 KPI 时用其 expression，不要另写聚合；`
          + `过滤用 semantic.dimensions.values 原文。`
          + `中间探查不要 presentAnswer、用 table。多子问题：每个子问题一张 presentAnswer=true 的最终表/图卡；`
          + `正文只做短总结，数字必须来自这些卡；若结果带采样估算须标明非全表精确。不要提右侧面板。问题：${q}`
        : '请进入问数模式：先 od_list_datasets 确认可用数据，再等我提出具体指标/维度问题；优先出表，需要时再出图；结果只在对话内展示。不要写看板。'
      submit(agent, text)
      return { kind: 'success', text: q ? '已发起问数' : '已进入问数模式' }
    },
  })

  ctx.commands.register({
    name: 'board',
    description: '一句话生成仪表盘（写入 draft，右侧可编辑）',
    input: { hint: '[看板主题，可选]' },
    handler: ({ agent, rawInput }) => {
      const theme = rawInput.trim()
      const text = theme
        ? `请生成仪表盘（严格 HITL）：
1) od_list_datasets 匹配数据集；可用 od_get_schema，禁止 od_run_query / od_run_sql
2) od_plan_charts(datasetId, message=用户原话) —— 展示分析目标后本轮必须停止；若 needClarify 只澄清
3) 同一轮绝对不要调用 od_generate_board；等用户回复「确认」/「生成」后再一次 od_generate_board（传 goals 与 plan 一致）
4) od_generate_board 成功后立刻结束本轮：一句话即可，不要继续思考或再调工具
主题：${theme}。message 必须带上用户原话。禁止自拼 patch / od_layout_board / od_emit_patch。`
        : '请生成仪表盘（严格 HITL）：od_list_datasets → od_plan_charts（禁止 query/sql）→ 展示目标后停止；用户确认后再一次 od_generate_board；写入成功后立刻结束本轮，不要继续思考。'
      submit(agent, text)
      return { kind: 'success', text: '已发起：生成仪表盘' }
    },
  })
}
