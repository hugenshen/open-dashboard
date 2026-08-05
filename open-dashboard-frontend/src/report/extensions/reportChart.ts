import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ReportChartView from '../nodeviews/ReportChartView.vue'

export const ReportChart = Node.create({
  name: 'reportChart',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null },
      source: { default: 'inline' },
      dashboardId: { default: null },
      chartId: { default: null },
      view: { default: 'published' },
      datasetId: { default: null },
      chartType: { default: 'bar' },
      encode: { default: {} },
      style: { default: {} },
      senior: { default: {} },
      title: { default: '' },
      width: { default: 'full' },
      height: { default: 320 }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="report-chart"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'report-chart' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(ReportChartView)
  }
})
