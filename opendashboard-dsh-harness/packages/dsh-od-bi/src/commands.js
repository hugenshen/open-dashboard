/**
 * OD slash commands for BI conversation (/datasets, /ask, /board).
 * Menu filtering of coding commands is done in dsh-od-nodes client.
 * @module @opendashboard/dsh-od-bi/commands
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { getBridge } from '@opendashboard/dsh-od-auth/bridge-state'

/** Pure follow-up text for /report (PR-ANR-01). */
export function buildReportFollowup(rawInput = '', opts = {}) {
  const q = String(rawInput || '').trim()
  const locked = opts.datasetId ? String(opts.datasetId).trim() : ''
  const pickDs = locked
    ? `使用已锁定 datasetId=${locked}（不要另选）`
    : 'od_list_datasets 匹配数据集'
  if (!q) {
    return `请进入分析报告模式：${pickDs}，等我提出具体解读/归因问题后再一次 od_board_worker（prompt 首行 ANALYSIS_REPORT=1）。不要生成看板。`
  }
  return `请写一份分析报告（不是仪表盘）：
1) ${pickDs}；可用 od_get_schema，禁止 od_run_query / od_run_sql / 自己调细工具
2) 一次 od_board_worker：description=写分析报告；prompt 第一行必须是 ANALYSIS_REPORT=1，并包含 datasetId 与用户原话。run_in_background 不要设 true。
3) 禁止 od_save_chart / od_commit_board / od_plan_charts。worker 取数 purpose=analysis（≤200 行 / 15s），取完可换维再取；图种由 harness 在有行后填写。
4) 成功后立刻结束本轮：一句话即可，不要提工具名。右侧会打开静态报告文件。
问题：${q}`
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
      const locked = getBridge().datasetId
      const lockHint = locked
        ? `当前已锁定 datasetId=${locked}，直接用它，不要再 od_list_datasets 选别的表。`
        : '请先 od_list_datasets 确认可用数据再选表。'
      const text = q
        ? `${lockHint}`
          + `请按问数路径回答（${locked ? '' : 'od_list_datasets → '}od_get_schema → od_run_query 或受控 od_run_sql → od_finish）。`
          + `od_get_schema 的 semantic.metrics 是已确认口径：点名 KPI 时用其 expression，不要另写聚合；`
          + `过滤用 semantic.dimensions.values 原文。`
          + `中间探查不要 presentAnswer、用 table。多子问题：每个子问题一张 presentAnswer=true 的最终表/图卡；`
          + `正文只做短总结，数字必须来自这些卡；若结果带采样估算须标明非全表精确。不要提右侧面板。问题：${q}`
        : `${lockHint}请进入问数模式：${locked ? '用锁定数据集' : '先 od_list_datasets 确认可用数据，再'}等我提出具体指标/维度问题；优先出表，需要时再出图；结果只在对话内展示。不要写看板。`
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
      const locked = getBridge().datasetId
      const pickDs = locked
        ? `使用已锁定 datasetId=${locked}（不要另选）`
        : 'od_list_datasets 匹配数据集'
      const text = theme
        ? `请生成或调整仪表盘（严格 HITL）：
1) 若已有 linked draft：用户要改其中一张或多张图 → od_get_board_summary → od_rechart_chart（同一 dashboardId，merge，禁止另开草稿）；成功后立刻结束本轮
2) 若尚无看板：${pickDs}；可用 od_get_schema，禁止 od_run_query / od_run_sql / od_get_data
3) od_plan_charts(datasetId, message=用户原话) —— 必须走 LLM，按数据特征拆分析任务（问题+维+度量），禁止锁死图种、禁止规则模板凑图；展示任务后本轮必须停止；若 needClarify 只澄清；plan failed 则告知用户，不要自己编图表，禁止因此改调 od_compose_board
4) 同一轮绝对不要调用 od_board_worker / od_generate_board；等用户回复「确认」/「生成」后再一次 od_board_worker：description=生成看板；prompt 必须包含 datasetId、title、用户原话、goalsForConfirm JSON 原文、已有 draft 的 dashboardId。run_in_background 不要设 true。禁止自己调 od_get_data / od_data_trans / od_save_chart / od_commit_board / od_run_query。仅当 worker 不可用时才退回 od_generate_board（须带同一 dashboardId）
5) od_board_worker / od_generate_board / od_rechart_chart 成功后立刻结束本轮：一句话即可，不要继续思考或再调工具
主题：${theme}。message 必须带上用户原话。禁止自拼 patch / od_layout_board / od_emit_patch。`
        : `请生成或调整仪表盘：已有 draft 时改图走 od_rechart_chart（同一 id）；否则 ${pickDs} → od_plan_charts（禁止 query/sql，只规划业务任务）→ 展示任务后停止；用户确认后再一次 od_board_worker（prompt 带 goalsForConfirm 与已有 dashboardId）；写入成功后立刻结束本轮。`
      submit(agent, text)
      return { kind: 'success', text: '已发起：生成仪表盘' }
    },
  })

  ctx.commands.register({
    name: 'report',
    description: '分析报告：取数洞察后在右侧预览 HTML/MD 快照（不是可刷新看板）',
    input: { hint: '[分析问题，可选]' },
    handler: ({ agent, rawInput }) => {
      const q = rawInput.trim()
      const text = buildReportFollowup(q, { datasetId: getBridge().datasetId })
      submit(agent, text)
      return { kind: 'success', text: q ? '已发起：分析报告' : '已进入分析报告模式' }
    },
  })
}
