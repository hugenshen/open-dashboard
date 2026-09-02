/**
 * Self-contained snapshot report (HTML + Markdown). Not a live dashboard.
 * Structure follows JoyAgent AutoAnalysis result: 分析过程 / 数据 / 分析结果 / 总结.
 * @module @opendashboard/dsh-od-bi/report-render
 */

import { flabel, fname, parseValueMapFromLabel } from './gen-board.js'

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function inlineMarkdown(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function slugifyHeading(text, index) {
  const s = String(text || '').trim().toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return s || `section-${index + 1}`
}

function extractMarkdownHeadings(markdown) {
  return [...String(markdown || '').matchAll(/^(##|###)\s+(.+)$/gm)]
    .map((m, index) => ({
      level: m[1].length,
      title: m[2].trim(),
      id: slugifyHeading(m[2], index),
    }))
}

function ensureMarkdownToc(markdown) {
  const text = String(markdown || '').trim()
  if (/^##\s*目录\s*$/m.test(text)) return text
  const headings = extractMarkdownHeadings(text).filter((h) => h.level === 2)
  if (headings.length < 3) return text
  const toc = [
    '## 目录',
    '',
    ...headings.map((h, index) => `${index + 1}. ${h.title}`),
    '',
  ].join('\n')
  return text.replace(/^(#\s+.+\n+)/, `$1\n${toc}\n`)
}

/** Render Agent-authored Markdown without imposing a report-content template. */
function markdownToSafeHtml(markdown) {
  const lines = String(markdown || '').split('\n')
  const out = []
  let listOpen = false
  let orderedOpen = false
  let tableOpen = false
  let codeOpen = false
  let headingSeq = 0
  const closeList = () => {
    if (listOpen) out.push('</ul>')
    listOpen = false
    if (orderedOpen) out.push('</ol>')
    orderedOpen = false
  }
  const closeTable = () => {
    if (tableOpen) out.push('</tbody></table>')
    tableOpen = false
  }
  for (const raw of lines) {
    if (/^```/.test(raw.trim())) {
      closeList()
      closeTable()
      out.push(codeOpen ? '</code></pre>' : '<pre><code>')
      codeOpen = !codeOpen
      continue
    }
    if (codeOpen) {
      out.push(`${esc(raw)}\n`)
      continue
    }
    const heading = raw.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      closeList()
      closeTable()
      const level = heading[1].length
      const id = level >= 2 && level <= 3 ? slugifyHeading(heading[2], headingSeq++) : ''
      out.push(`<h${level}${id ? ` id="${esc(id)}"` : ''}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    if (/^\|(.+)\|$/.test(raw.trim()) && !/^\|[\s|:-]+\|$/.test(raw.trim())) {
      closeList()
      const cells = raw.trim().slice(1, -1).split('|').map((c) => c.trim())
      if (!tableOpen) {
        out.push('<table><thead><tr>' + cells.map((c) => `<th>${inlineMarkdown(c)}</th>`).join('') + '</tr></thead><tbody>')
        tableOpen = true
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${inlineMarkdown(c)}</td>`).join('') + '</tr>')
      }
      continue
    }
    if (/^\|[\s|:-]+\|$/.test(raw.trim())) continue
    closeTable()
    if (/^[-*]\s+/.test(raw)) {
      if (orderedOpen) { out.push('</ol>'); orderedOpen = false }
      if (!listOpen) out.push('<ul>')
      listOpen = true
      out.push(`<li>${inlineMarkdown(raw.replace(/^[-*]\s+/, ''))}</li>`)
      continue
    }
    const ordered = raw.match(/^\d+[.)]\s+(.+)$/)
    if (ordered) {
      if (listOpen) { out.push('</ul>'); listOpen = false }
      if (!orderedOpen) out.push('<ol>')
      orderedOpen = true
      out.push(`<li>${inlineMarkdown(ordered[1])}</li>`)
      continue
    }
    closeList()
    if (/^---+$/.test(raw.trim())) out.push('<hr/>')
    else if (/^>\s*/.test(raw)) out.push(`<blockquote>${inlineMarkdown(raw.replace(/^>\s*/, ''))}</blockquote>`)
    else if (raw.trim()) out.push(`<p>${inlineMarkdown(raw)}</p>`)
  }
  closeList()
  closeTable()
  if (codeOpen) out.push('</code></pre>')
  return out.join('\n')
}

export function renderAuthoredReport(input = {}) {
  const title = String(input.title || '分析报告')
  let markdown = String(input.markdown || '').trim()
  if (!/^#\s+/.test(markdown)) markdown = `# ${title}\n\n${markdown}`
  markdown = ensureMarkdownToc(markdown)
  const body = markdownToSafeHtml(markdown)
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${esc(title)}</title><style>
body{font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#1f2329;margin:28px;max-width:980px}
h1{font-size:26px;margin:0 0 12px}h2{font-size:18px;margin:28px 0 10px;padding-top:14px;border-top:1px solid #edf0f5}h3{font-size:15px;margin:20px 0 8px}
p,li{max-width:86ch}ul,ol{padding-left:22px}blockquote{margin:12px 0;padding:10px 14px;border-left:4px solid #4d6bfe;background:#f5f7ff;color:#303133;border-radius:0 8px 8px 0}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}code{background:#f3f4f6;padding:1px 4px;border-radius:3px}
pre{white-space:pre-wrap;background:#f6f7f9;padding:12px;border-radius:6px}hr{border:0;border-top:1px solid #e5e7eb;margin:24px 0}
table{border-collapse:collapse;width:100%;margin:10px 0 16px;font-size:13px}th,td{border:1px solid #e5e7eb;padding:7px 9px;text-align:left;vertical-align:top}th{background:#f5f6f8;font-weight:650}
footer{margin-top:30px;padding-top:12px;border-top:1px solid #eceef2;color:#8f959e;font-size:12px}
</style></head><body>${body}<footer>静态快照 · 非可刷新看板 · 聚合上限 200 行 · 15s 超时。刷新本页不会重新查询。</footer></body></html>`
  return { title, html, markdown: `${markdown}\n\n---\n\n静态快照 · 非可刷新看板 · 聚合上限 200 行 · 15s 超时。\n` }
}

function asRecords(rows, frame = {}) {
  if (!Array.isArray(rows)) return []
  const category = String(frame?.chart?.encode?.category || '')
  const value = String(frame?.chart?.encode?.value || '')
  return rows.map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      if (category && value && !Object.hasOwn(row, category) && !Object.hasOwn(row, value)
        && Object.hasOwn(row, 'label') && Object.hasOwn(row, 'value')) {
        return { [category]: row.label, [value]: row.value }
      }
      return row
    }
    if (Array.isArray(row)) {
      const o = {}
      row.forEach((v, i) => {
        o[i === 0 ? (category || '分类') : i === 1 ? (value || '指标值') : `指标${i + 1}`] = v
      })
      return o
    }
    return { [value || '指标值']: row }
  })
}

function fieldOf(frame, key) {
  return (Array.isArray(frame?.fields) ? frame.fields : []).find((f) => fname(f) === key)
}

function fieldPresentation(frame, key) {
  const field = fieldOf(frame, key)
  const cfg = frame?.chart?.encode?.fieldCfg?.[key] || {}
  return {
    label: String(cfg.alias || (field ? flabel(field) : key) || key),
    valueMap: cfg.valueMap || field?.valueMap || parseValueMapFromLabel(field?.label),
    fen: /单位\s*[:：]?\s*分|单位分/.test(String(field?.label || '')),
  }
}

function formatNumber(value, { fen = false } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '')
  const base = fen ? n * 0.01 : n
  const abs = Math.abs(base)
  if (fen && abs >= 1e8) return `${(base / 1e8).toFixed(2)} 亿元`
  if (fen && abs >= 1e4) return `${(base / 1e4).toFixed(2)} 万元`
  if (fen) return `${base.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`
  return base.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function displayValue(frame, key, value) {
  const present = fieldPresentation(frame, key)
  const mapped = present.valueMap?.[String(value)]
  if (mapped != null) return String(mapped)
  if (present.valueMap && Object.keys(present.valueMap).length) {
    const kind = /状态/.test(present.label) ? '状态' : '枚举值'
    return `未定义${kind}（${String(value)}）`
  }
  if (typeof value === 'number' || (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))) {
    return formatNumber(value, present)
  }
  return String(value ?? '')
}

function tableHtml(frame, limit = 20) {
  const recs = asRecords(frame?.rows, frame).slice(0, limit)
  if (!recs.length) return '<p class="muted">无快照行</p>'
  const keys = Object.keys(recs[0])
  const thead = keys.map((k) => `<th>${esc(fieldPresentation(frame, k).label)}</th>`).join('')
  const body = recs.map((r) => `<tr>${keys.map((k) => `<td>${esc(displayValue(frame, k, r[k]))}</td>`).join('')}</tr>`).join('')
  return `<table><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table>`
}

function tableMd(frame, limit = 20) {
  const recs = asRecords(frame?.rows, frame).slice(0, limit)
  if (!recs.length) return '_无快照行_'
  const keys = Object.keys(recs[0])
  const head = `| ${keys.map((k) => fieldPresentation(frame, k).label).join(' | ')} |`
  const sep = `| ${keys.map(() => '---').join(' | ')} |`
  const body = recs.map((r) => `| ${keys.map((k) => displayValue(frame, k, r[k])).join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

function barHtml(frame) {
  const recs = asRecords(frame?.rows, frame).slice(0, 12)
  const chartType = frame?.suggestedChartType
  if (!recs.length || chartType === 'kpi') return ''
  const keys = Object.keys(recs[0] || {})
  const labelKey = keys[0]
  const valueKey = keys.find((k, i) => i > 0 && typeof recs[0][k] === 'number') || keys[1]
  const vals = recs.map((r) => Number(r[valueKey]) || 0)
  const max = Math.max(...vals.map((n) => Math.abs(n)), 1)
  return `<div class="bars">${recs.map((r, i) => {
    const w = Math.round((Math.abs(vals[i]) / max) * 100)
    return `<div class="bar-row"><span class="lab">${esc(displayValue(frame, labelKey, r[labelKey]))}</span><span class="bar"><i style="width:${w}%"></i></span><span class="n">${esc(displayValue(frame, valueKey, r[valueKey]))}</span></div>`
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

function allInsightItems(insights) {
  return (Array.isArray(insights) ? insights : [])
    .flatMap((block) => Array.isArray(block?.items) ? block.items : [])
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean)
}

function mdEscPara(text) {
  return String(text || '').trim()
}

function businessOrder(frame) {
  const category = String(frame?.chart?.encode?.category || '').toLowerCase()
  const value = String(frame?.chart?.encode?.value || '').toLowerCase()
  if (/status|状态/.test(category)) {
    return category === value || /order|订单/.test(value) ? 20 : 10
  }
  if (/mchid|merchant|商户|store|门店|agent|代理/.test(category)) return 30
  return 40
}

/**
 * @param {{ title?: string, summary?: string, insights?: object[], frames?: object[] }} input
 */
export function renderReport(input = {}) {
  const title = String(input.title || '分析报告')
  const summary = mdEscPara(input.summary)
  const insights = Array.isArray(input.insights) ? input.insights : []
  const frames = (Array.isArray(input.frames) && input.frames.length
    ? input.frames
    : insights.map((b) => ({
      handle: b.handle,
      title: b.title,
      process: b.process,
      suggestedChartType: b.suggestedChartType,
      rowCount: b.rowCount,
      rows: b.rows,
      items: b.items,
    }))).map((frame, index) => ({ ...frame, __inputOrder: index }))
    .sort((a, b) => businessOrder(a) - businessOrder(b) || a.__inputOrder - b.__inputOrder)
  const byHandle = new Map(insights.map((b) => [b.handle, b]))
  const findingItems = allInsightItems(insights)
  const summaryText = summary || findingItems[0] || '本报告基于当前对话中的聚合取数结果生成，重点呈现可由证据支持的业务发现。'
  const findingsHtml = findingItems.length
    ? `<ul>${findingItems.slice(0, 8).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '<p class="muted">当前样本未形成显著洞察，建议补充时间、渠道、商户等业务维度后继续分析。</p>'
  const findingsMd = findingItems.length
    ? findingItems.slice(0, 8).map((item) => `- ${item}`).join('\n')
    : '_当前样本未形成显著洞察，建议补充时间、渠道、商户等业务维度后继续分析。_'

  const sectionsHtml = frames.map((f) => {
    const block = byHandle.get(f.handle) || f
    const process = f.process || block.process || f.title || '分析切片'
    return `
    <section>
      <h3>${esc(process)}</h3>
      <h4>数据</h4>
      <p class="muted">${esc(f.title || f.handle || '')} · 建议图种 ${esc(f.suggestedChartType || 'table')} · ${esc(f.rowCount || 0)} 行快照</p>
      ${barHtml(f)}
      ${tableHtml(f)}
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

${tableMd(f)}

#### 分析结果

${insightMd(block)}`
  }).join('\n\n')

  const recommendationHtml = findingItems.length
    ? '<p>建议优先复核贡献最高或波动最明显的业务主体，并结合时间、渠道、产品等维度继续交叉验证；所有判断以附录中的聚合快照为依据。</p>'
    : '<p>建议先补充可解释的业务维度和时间范围，再重新生成报告；当前结果不应直接作为经营决策依据。</p>'
  const recommendationMd = findingItems.length
    ? '建议优先复核贡献最高或波动最明显的业务主体，并结合时间、渠道、产品等维度继续交叉验证；所有判断以附录中的聚合快照为依据。'
    : '建议先补充可解释的业务维度和时间范围，再重新生成报告；当前结果不应直接作为经营决策依据。'

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
  .lab{width:128px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4b5563}
  .bar{flex:1;height:8px;background:#eef0f4;border-radius:4px}
  .bar i{display:block;height:100%;background:#4d6bfe;border-radius:4px}
  .n{width:112px;text-align:right;font-variant-numeric:tabular-nums;color:#6b7280}
  footer{margin-top:28px;padding-top:12px;border-top:1px solid #eceef2;color:#8f959e;font-size:12px}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">对话分析报告 · 静态快照 · 非可刷新看板</p>
<h2>报告摘要</h2>
<p>${esc(summaryText).replace(/\n/g, '<br/>')}</p>
<h2>核心发现</h2>
${findingsHtml}
<h2>分主题分析</h2>
${sectionsHtml}
<h2>结论与建议</h2>
${recommendationHtml}
<h2>附录：数据口径与证据</h2>
<p class="muted">本附录保留本次对话分析使用的聚合快照。报告为静态文件，刷新不会重新查询；分析取数上限 200 行，超时 15 秒。</p>
<footer>静态快照 · 非可刷新看板 · 聚合上限 200 行 · 15s 超时。刷新本页不会重新查询。</footer>
</body></html>`

  const markdown = ensureMarkdownToc(`# ${title}

对话分析报告 · 静态快照 · 非可刷新看板

## 报告摘要

${summaryText}

## 核心发现

${findingsMd}

## 分主题分析

${sectionsMd}

## 结论与建议

${recommendationMd}

## 附录：数据口径与证据

本附录保留本次对话分析使用的聚合快照。报告为静态文件，刷新不会重新查询；分析取数上限 200 行，超时 15 秒。

---

静态快照 · 非可刷新看板 · 聚合上限 200 行 · 15s 超时。刷新本页不会重新查询。
`)

  return { title, html, markdown }
}
