/**
 * P012 UX 旅程 · 对话流脚本（对齐真实 dsh 表面：用户气泡 / Think / 工具卡 / 结果 Node）。
 * 不调用 Agent；文案对齐 test-report-ux-journey.md
 */

export type JourneyVerdict = 'pass' | 'partial' | 'fail'

export type ReplayCardKind = 'plan' | 'chart' | 'table' | 'board'

export type ReplayMsg =
  | { role: 'user'; text: string; delayMs?: number }
  | { role: 'assistant'; text: string; delayMs?: number }
  | {
      role: 'think'
      preview: string
      body: string
      collapsed?: boolean
      delayMs?: number
    }
  | {
      role: 'tool'
      name: string
      hint: string
      status?: 'done' | 'running'
      body?: string
      delayMs?: number
    }
  | {
      role: 'card'
      kind: ReplayCardKind
      title: string
      body: string
      /** board 卡可带 draft id，打开右侧编辑器 */
      dashboardId?: string
      delayMs?: number
    }
  | { role: 'system'; text: string; delayMs?: number }

export interface JourneyScene {
  id: string
  title: string
  sessionTitle: string
  verdict: JourneyVerdict
  verdictLabel: string
  draftHint?: string
  evidence?: string[]
  messages: ReplayMsg[]
}

const d = (ms: number) => ms

export const UX_JOURNEY_SCENES: JourneyScene[] = [
  {
    id: 'S1',
    title: '自然语言出板',
    sessionTitle: '按支付状态看入账 · 出板',
    verdict: 'partial',
    verdictLabel: '初测部分通过 · 回归 HITL 已过',
    draftHint: 'Draft 74',
    evidence: ['/ux-journey/S1-board-generated.png'],
    messages: [
      {
        role: 'user',
        text: '用商户订单表生成一张经营看板：按支付状态看入账',
        delayMs: d(1200),
      },
      {
        role: 'think',
        preview: 'profile → plan，等确认再 generate…',
        body: '命中商户订单表。先 od_plan_charts，本轮不写板。',
        collapsed: true,
        delayMs: d(800),
      },
      {
        role: 'tool',
        name: 'od_profile_dataset',
        hint: '商户订单表',
        status: 'done',
        body: 'dims: Status, MchType, ChannelType\nmeasures: Amount, MchIncome',
        delayMs: d(700),
      },
      {
        role: 'tool',
        name: 'od_plan_charts',
        hint: '3 goals · 待确认',
        status: 'done',
        body: 'kpi · 商户入账\nbar · Status × Amount\ngrouptable · 明细',
        delayMs: d(900),
      },
      {
        role: 'card',
        kind: 'plan',
        title: '图表计划（待确认）',
        body: '1. KPI · 商户入账合计\n2. 柱图 · 按支付状态汇总 Amount\n3. 分组表 · 状态 × 金额\n\n回复「确认」后写入；也可先改目标。',
        delayMs: d(1100),
      },
      {
        role: 'assistant',
        text: '计划已列出。确认后我再生成看板。',
        delayMs: d(900),
      },
      {
        role: 'system',
        text: '初测曾跳过确认直接 generate；回归后 plan 本轮禁止 od_generate_board。',
        delayMs: d(900),
      },
      {
        role: 'user',
        text: '确认，按这个计划出板',
        delayMs: d(1000),
      },
      {
        role: 'tool',
        name: 'od_generate_board',
        hint: 'emit_patch → Draft 74',
        status: 'done',
        body: 'mode=replace · charts=3',
        delayMs: d(900),
      },
      {
        role: 'card',
        kind: 'board',
        title: 'AI 生成看板 · Draft 74',
        body: 'KPI · 柱 · 表已写入。点「在右侧打开」继续微调。',
        dashboardId: '74',
        delayMs: d(1100),
      },
    ],
  },
  {
    id: 'S2',
    title: '确认前改目标',
    sessionTitle: '去掉饼图再确认',
    verdict: 'partial',
    verdictLabel: '初测漂移 · 回归已过',
    draftHint: 'Draft 79',
    evidence: [
      '/ux-journey/S2-plan-waiting.png',
      '/ux-journey/S2-confirm-regen-drift.png',
    ],
    messages: [
      {
        role: 'user',
        text: '先只 plan，不要生成。等我确认。',
        delayMs: d(1000),
      },
      {
        role: 'tool',
        name: 'od_plan_charts',
        hint: '含饼图 · 等待确认',
        status: 'done',
        body: 'pie · Status 占比\nbar · Status\ntable',
        delayMs: d(800),
      },
      {
        role: 'card',
        kind: 'plan',
        title: '计划已列出 · 等待确认',
        body: '含饼图占比 + Status 柱 + 表。本轮不会写板。',
        delayMs: d(1000),
      },
      {
        role: 'user',
        text: '去掉饼图，改成 Status 柱 + MchType 柱 + 表，然后确认生成',
        delayMs: d(1200),
      },
      {
        role: 'think',
        preview: 'goalsForConfirm round-trip…',
        body: '删饼；绑定 Status / MchType 双柱。',
        collapsed: true,
        delayMs: d(700),
      },
      {
        role: 'tool',
        name: 'od_generate_board',
        hint: 'Draft 79',
        status: 'done',
        body: 'no pie · Status bar · MchType bar · table',
        delayMs: d(900),
      },
      {
        role: 'card',
        kind: 'board',
        title: '看板已更新 · Draft 79',
        body: '无饼图；Status 柱 + MchType 柱 + 表。',
        dashboardId: '79',
        delayMs: d(1100),
      },
      {
        role: 'system',
        text: '初测 goals 被拒曾回退 rules 带回饼图；回归后显式 goals 全拒不再静默 fallback。',
        delayMs: d(900),
      },
    ],
  },
  {
    id: 'S3',
    title: '出板后对话改图',
    sessionTitle: '加 ChannelType 对比',
    verdict: 'fail',
    verdictLabel: '初测失败 · 回归已过',
    draftHint: 'Draft 79',
    evidence: ['/ux-journey/S3-adjust-stuck.png'],
    messages: [
      {
        role: 'user',
        text: '把占比改成柱图，再加一张渠道类型（ChannelType）对比柱图',
        delayMs: d(1100),
      },
      {
        role: 'tool',
        name: 'od_generate_board',
        hint: 'ChannelType 绑定',
        status: 'done',
        body: '删饼 · Status 柱 · ChannelType 柱',
        delayMs: d(1000),
      },
      {
        role: 'card',
        kind: 'board',
        title: '看板已调整 · Draft 79',
        body: '删饼 · Status 柱 · ChannelType 柱。初测曾错绑 MchType。',
        dashboardId: '79',
        delayMs: d(1100),
      },
      {
        role: 'system',
        text: '修复：resolveFieldRef +「渠道类型」→ ChannelType。',
        delayMs: d(800),
      },
    ],
  },
  {
    id: 'S4',
    title: '换主题新出板',
    sessionTitle: '按商户类型看入账',
    verdict: 'pass',
    verdictLabel: '通过',
    draftHint: 'Draft 75（未覆盖 74）',
    evidence: ['/ux-journey/S4-new-theme-board.png'],
    messages: [
      {
        role: 'user',
        text: '换个主题重新出板：按商户类型（MchType）看商户入账',
        delayMs: d(1100),
      },
      {
        role: 'assistant',
        text: '会新建一张板，不覆盖上一张 Draft。',
        delayMs: d(800),
      },
      {
        role: 'tool',
        name: 'od_plan_charts',
        hint: '新主题',
        status: 'done',
        body: 'kpi · MchIncome\nbar · MchType × MchIncome',
        delayMs: d(800),
      },
      {
        role: 'user',
        text: '确认',
        delayMs: d(700),
      },
      {
        role: 'card',
        kind: 'board',
        title: '新 Draft 75 已创建',
        body: '主题切换成功；原 Draft 74 仍保留。',
        dashboardId: '75',
        delayMs: d(1100),
      },
    ],
  },
  {
    id: 'S5',
    title: '出板后追问问数',
    sessionTitle: 'Status=2 支付金额',
    verdict: 'pass',
    verdictLabel: '通过',
    draftHint: '仍为 Draft 74',
    evidence: ['/ux-journey/S5-ask-after-board.png'],
    messages: [
      {
        role: 'user',
        text: '不要改看板。只问数：Status=2 支付金额合计',
        delayMs: d(1100),
      },
      {
        role: 'tool',
        name: 'od_run_query',
        hint: 'Status=2 · Amount',
        status: 'done',
        body: 'bar · 对话内预览 · 未写板',
        delayMs: d(900),
      },
      {
        role: 'card',
        kind: 'chart',
        title: '临时图 · Status=2 支付金额',
        body: 'bar · 含轴标签与 SQL\n看板 ID 不变',
        delayMs: d(1100),
      },
      {
        role: 'card',
        kind: 'table',
        title: '问数结果表',
        body: '样例行已回传 · 仅会话预览',
        delayMs: d(900),
      },
      {
        role: 'assistant',
        text: '只做了问数，没有改当前看板。',
        delayMs: d(800),
      },
    ],
  },
  {
    id: 'S6',
    title: '先问数再出板',
    sessionTitle: '问数 → 按口径出板',
    verdict: 'partial',
    verdictLabel: '初测部分通过 · 回归已过',
    draftHint: 'Draft 77',
    evidence: [
      '/ux-journey/S6a-ask-first.png',
      '/ux-journey/S6b-board-after-ask.png',
    ],
    messages: [
      {
        role: 'user',
        text: '先问数：各支付状态入账金额汇总，取前几档',
        delayMs: d(1100),
      },
      {
        role: 'tool',
        name: 'od_run_query',
        hint: 'Status × Amount',
        status: 'done',
        body: 'rowCount + 样例行（回归后对 LLM 可见）',
        delayMs: d(900),
      },
      {
        role: 'card',
        kind: 'chart',
        title: '按支付状态汇总金额',
        body: 'bar · 对话内预览',
        delayMs: d(1000),
      },
      {
        role: 'user',
        text: '按刚才口径出板',
        delayMs: d(1000),
      },
      {
        role: 'card',
        kind: 'plan',
        title: '沿用问数口径',
        body: 'Status × Amount 柱 + KPI/表。确认后写入。',
        delayMs: d(900),
      },
      {
        role: 'user',
        text: '确认',
        delayMs: d(700),
      },
      {
        role: 'card',
        kind: 'board',
        title: 'Draft 77 已写入',
        body: '问数 → 出板链路可用。',
        dashboardId: '77',
        delayMs: d(1100),
      },
    ],
  },
]

export const UX_JOURNEY_DEFAULT_DELAY_MS = 1000

/** 用户气泡出现前，Composer 打字节奏（每字毫秒，再除以倍速） */
export const UX_JOURNEY_TYPE_MS_PER_CHAR = 28

/** @deprecated */
export const UX_JOURNEY_STEPS = UX_JOURNEY_SCENES
export const UX_JOURNEY_STEP_MS = 4500
export type JourneyStep = JourneyScene
