import type { Editor } from '@tiptap/core'
import type { ReportChartAttrs } from '../types'

type TipTapNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  text?: string
}

export function walkNodes(node: TipTapNode | null | undefined, fn: (n: TipTapNode) => void) {
  if (!node) return
  fn(node)
  for (const child of node.content || []) walkNodes(child, fn)
}

export function walkReportCharts(
  doc: TipTapNode,
  fn: (attrs: ReportChartAttrs) => void
) {
  walkNodes(doc, (n) => {
    if (n.type === 'reportChart' && n.attrs) {
      fn(n.attrs as ReportChartAttrs)
    }
  })
}

export function findReportChartAttrs(
  doc: TipTapNode,
  id: string
): ReportChartAttrs | null {
  let found: ReportChartAttrs | null = null
  walkReportCharts(doc, (a) => {
    if (a.id === id) found = a
  })
  return found
}

export function countReportCharts(content: Record<string, unknown>) {
  let total = 0
  let dashboard = 0
  let inline = 0
  const dashIds = new Set<string>()
  walkReportCharts(content as TipTapNode, (a) => {
    total++
    if (a.source === 'dashboard') {
      dashboard++
      if (a.dashboardId) dashIds.add(String(a.dashboardId))
    } else inline++
  })
  return { total, dashboard, inline, dashboardCount: dashIds.size }
}

export type TocItem = {
  id: string
  text: string
  level: number
  kind: 'heading' | 'chart'
  chartId?: string
}

export function buildReportToc(doc: TipTapNode): TocItem[] {
  const items: TocItem[] = []
  let headingIdx = 0
  let headingOrd = 0
  walkNodes(doc, (n) => {
    if (n.type === 'heading') {
      const level = Number(n.attrs?.level || 1)
      const text = collectText(n) || `标题 ${++headingIdx}`
      items.push({ id: `h_${headingOrd++}`, text, level, kind: 'heading' })
    }
    if (n.type === 'reportChart' && n.attrs) {
      const a = n.attrs as ReportChartAttrs
      const text = a.title || (a.source === 'dashboard' ? `图表 ${a.chartId}` : '图表')
      items.push({
        id: `rc_${a.id}`,
        text,
        level: 2,
        kind: 'chart',
        chartId: a.id
      })
    }
  })
  return items
}

function collectText(node: TipTapNode): string {
  if (node.text) return node.text
  return (node.content || []).map(collectText).join('')
}

export function findReportChartEditor(editor: Editor, id: string) {
  let found: { pos: number; attrs: ReportChartAttrs } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'reportChart' && node.attrs.id === id) {
      found = { pos, attrs: node.attrs as ReportChartAttrs }
    }
  })
  return found
}

export function patchReportChartEditor(
  editor: Editor,
  id: string,
  patch: Partial<ReportChartAttrs>
) {
  const hit = findReportChartEditor(editor, id)
  if (!hit) return false
  editor
    .chain()
    .focus()
    .setNodeSelection(hit.pos)
    .updateAttributes('reportChart', patch)
    .run()
  return true
}

export function selectReportChartEditor(editor: Editor, id: string) {
  const hit = findReportChartEditor(editor, id)
  if (!hit) return false
  editor.chain().focus().setNodeSelection(hit.pos).run()
  return true
}

export function deleteReportChartEditor(editor: Editor, id: string) {
  const hit = findReportChartEditor(editor, id)
  if (!hit) return false
  const node = editor.state.doc.nodeAt(hit.pos)
  if (!node) return false
  editor.chain().focus().deleteRange({ from: hit.pos, to: hit.pos + node.nodeSize }).run()
  return true
}

/** Heuristic folder from report name for list tree */
export function inferReportFolder(name: string): string {
  if (/周报/.test(name)) return '周报'
  if (/月报/.test(name)) return '月报'
  if (/归档|archive/i.test(name)) return '归档'
  return '未分组'
}

export function formatUpdateTime(ts?: number | null): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return '—'
  }
}
