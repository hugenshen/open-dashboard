/**
 * Self-contained snapshot report (HTML + Markdown). Not a live dashboard.
 * Structure follows JoyAgent AutoAnalysis result: 分析过程 / 数据 / 分析结果 / 总结.
 * @module @opendashboard/dsh-od-bi/report-render
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function asRecords(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) return row
    if (Array.isArray(row)) {
      const o = {}
      row.forEach((v, i) => { o[i === 0 ? 'label' : i === 1 ? 'value' : `c${i}`] = v })
      return o
    }
    return { value: row }
  })
}

function tableHtml(rows, limit = 20) {
  const recs = asRecords(rows).slice(0, limit)
  if (!recs.length) return '<p class="muted">无快照行</p>'
  const keys = Object.keys(recs[0])
  const thead = keys.map((k) => `<th>${esc(k)}</th>`).join('')
  const body = recs.map((r) => `<tr>${keys.map((k) => `<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')
  return `<table><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table>`
}

function tableMd(rows, limit = 20) {
  const recs = asRecords(rows).slice(0, limit)
  if (!recs.length) return '_无快照行_'
  const keys = Object.keys(recs[0])
  const head = `| ${keys.join(' | ')} |`
  const sep = `| ${keys.map(() => '---').join(' | ')} |`
  const body = recs.map((r) => `| ${keys.map((k) => String(r[k] ?? '')).join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

function barHtml(rows, chartType) {
  const recs = asRecords(rows).slice(0, 12)
  if (!recs.length || chartType === 'kpi') return ''
  const keys = Object.keys(recs[0] || {})
  const labelKey = keys[0]
  const valueKey = keys.find((k, i) => i > 0 && typeof recs[0][k] === 'number') || keys[1]
  const vals = recs.map((r) => Number(r[valueKey]) || 0)
  const max = Math.max(...vals.map((n) => Math.abs(n)), 1)
  return `<div class="bars">${recs.map((r, i) => {
    const w = Math.round((Math.abs(vals[i]) / max) * 100)
    return `<div class="bar-row"><span class="lab">${esc(r[labelKey])}</span><span class="bar"><i style="width:${w}%"></i></span><span class="n">${esc(vals[i])}</span></div>`
  }).join('')}</div>`
}

function insightLis(block) {
  const items = Array.isArray(block?.items) ? block.items : []
  if (!items.length) return '<li>尚无洞察条目</li>'
  return items.map((it) => `<li>${esc(it.text)}</li>`).join('')
}

function insightMd(block) {
  const items = Array.isArray(block?.items) ? block.items : []
  if (!items.length) return '- 尚无洞察条目'
  return items.map((it) => `- ${it.text}`).join('\n')
}

function mdEscPara(text) {
  return String(text || '').trim()
}

/**
 * @param {{ title?: string, summary?: string, insights?: object[], frames?: object[] }} input
 */
export function renderReport(input = {}) {
  const title = String(input.title || '分析报告')
  const summary = mdEscPara(input.summary)
  const insights = Array.isArray(input.insights) ? input.insights : []
  const frames = Array.isArray(input.frames) && input.frames.length
    ? input.frames
    : insights.map((b) => ({
      handle: b.handle,
      title: b.title,
      process: b.process,
      suggestedChartType: b.suggestedChartType,
      rowCount: b.rowCount,
      rows: b.rows,
      items: b.items,
    }))
  const byHandle = new Map(insights.map((b) => [b.handle, b]))

  const sectionsHtml = frames.map((f) => {
    const block = byHandle.get(f.handle) || f
    const process = f.process || block.process || f.title || '分析切片'
    return `
    <section>
      <h3>${esc(process)}</h3>
      <h4>数据</h4>
      <p class="muted">${esc(f.title || f.handle || '')} · 建议图种 ${esc(f.suggestedChartType || 'table')} · ${esc(f.rowCount || 0)} 行快照</p>
      ${barHtml(f.rows, f.suggestedChartType)}
      ${tableHtml(f.rows)}
      <h4>分析结果</h4>
      <ul>${insightLis(block)}</ul>
    </section>`
  }).join('') || '<p class="muted">尚无分析切片</p>'

  const sectionsMd = frames.map((f) => {
    const block = byHandle.get(f.handle) || f
    const process = f.process || block.process || f.title || '分析切片'
    return `### ${process}

#### 数据

${f.title || f.handle || ''} · 建议图种：${f.suggestedChartType || 'table'} · ${f.rowCount || 0} 行快照

${tableMd(f.rows)}

#### 分析结果

${insightMd(block)}`
  }).join('\n\n')

  const summaryHtml = summary
    ? `<h2>总结</h2><p>${esc(summary).replace(/\n/g, '<br/>')}</p>`
    : ''
  const summaryMd = summary ? `## 总结\n\n${summary}\n` : ''

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#1f2329;margin:24px;max-width:860px}
  h1{font-size:22px;margin:0 0 8px}
  h2{font-size:16px;margin:24px 0 8px}
  h3{font-size:15px;margin:20px 0 8px}
  h4{font-size:13px;margin:12px 0 6px;color:#4b5563}
  .muted{color:#8f959e;font-size:12px}
  table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:13px}
  th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}
  th{background:#f5f6f8}
  .bars{display:flex;flex-direction:column;gap:6px;margin:8px 0 12px}
  .bar-row{display:flex;align-items:center;gap:8px}
  .lab{width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4b5563}
  .bar{flex:1;height:8px;background:#eef0f4;border-radius:4px}
  .bar i{display:block;height:100%;background:#4d6bfe;border-radius:4px}
  .n{width:72px;text-align:right;font-variant-numeric:tabular-nums;color:#6b7280}
  footer{margin-top:28px;padding-top:12px;border-top:1px solid #eceef2;color:#8f959e;font-size:12px}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">对话分析报告 · 静态快照 · 非可刷新看板</p>
<h2>分析过程</h2>
${sectionsHtml}
${summaryHtml}
<footer>静态快照 · 非可刷新看板 · 聚合上限 200 行 · 15s 超时。刷新本页不会重新查询。</footer>
</body></html>`

  const markdown = `# ${title}

对话分析报告 · 静态快照 · 非可刷新看板

## 分析过程

${sectionsMd}

${summaryMd}
---

静态快照 · 非可刷新看板 · 聚合上限 200 行 · 15s 超时。刷新本页不会重新查询。
`

  return { title, html, markdown }
}
