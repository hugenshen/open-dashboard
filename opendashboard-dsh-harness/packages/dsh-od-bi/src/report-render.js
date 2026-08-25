/**
 * Self-contained snapshot report (HTML + Markdown). Not a live dashboard.
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
      row.forEach((v, i) => { o[`c${i}`] = v })
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

/**
 * @param {{ title?: string, insights?: object[], frames?: object[] }} input
 */
export function renderReport(input = {}) {
  const title = String(input.title || '分析报告')
  const insights = Array.isArray(input.insights) ? input.insights : []
  const frames = Array.isArray(input.frames) ? input.frames : []
  const insightLis = insights.flatMap((block) => (block.items || []).map((it) => `<li>${esc(it.text)}</li>`)).join('')
    || '<li>尚无洞察条目</li>'
  const insightMd = insights.flatMap((block) => (block.items || []).map((it) => `- ${it.text}`)).join('\n')
    || '- 尚无洞察条目'
  const sectionsHtml = frames.map((f) => `
    <section>
      <h2>${esc(f.title || f.handle || '分析切片')}</h2>
      <p class="muted">建议图种（有数后由规则确定）：${esc(f.suggestedChartType || 'table')} · ${esc(f.rowCount || 0)} 行快照</p>
      ${barHtml(f.rows, f.suggestedChartType)}
      ${tableHtml(f.rows)}
    </section>`).join('')
  const sectionsMd = frames.map((f) => `## ${f.title || f.handle || '分析切片'}

建议图种：${f.suggestedChartType || 'table'} · ${f.rowCount || 0} 行快照

${tableMd(f.rows)}`).join('\n\n')

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#1f2329;margin:24px;max-width:860px}
  h1{font-size:22px;margin:0 0 8px}
  h2{font-size:16px;margin:24px 0 8px}
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
<h2>洞察</h2>
<ul>${insightLis}</ul>
${sectionsHtml}
<footer>静态快照 · 非可刷新看板 · 聚合上限 200 行 · 15s 超时。刷新本页不会重新查询。</footer>
</body></html>`

  const markdown = `# ${title}

对话分析报告 · 静态快照 · 非可刷新看板

## 洞察

${insightMd}

${sectionsMd}

---

静态快照 · 非可刷新看板 · 聚合上限 200 行 · 15s 超时。刷新本页不会重新查询。
`

  return { title, html, markdown }
}
