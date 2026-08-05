/**
 * 通用图表结果 → CSV 下载（带 BOM，Excel 可直接打开）
 */
export type ChartDownloadInput = {
  fields?: Array<{ name: string; type?: string }>
  data?: unknown[][]
  series?: Record<string, unknown> | null
  filename?: string
}

export function chartResultToCsv(input: ChartDownloadInput): string {
  const lines: string[] = []
  const fields = input.fields || []
  const data = input.data || []

  if (fields.length) {
    lines.push(fields.map((f) => csvEscape(f.name)).join(','))
    for (const row of data) {
      lines.push(fields.map((_, i) => csvEscape(row?.[i] ?? '')).join(','))
    }
    return '\uFEFF' + lines.join('\n')
  }

  const series = input.series
  if (series && Array.isArray(series.categories) && Array.isArray(series.series)) {
    const cats = series.categories as unknown[]
    const seriesList = series.series as Array<{ name?: string; data?: unknown[] }>
    lines.push(['name', ...seriesList.map((s) => s.name || 'value')].map(csvEscape).join(','))
    cats.forEach((name, i) => {
      lines.push(
        [name, ...seriesList.map((s) => (s.data || [])[i] ?? '')].map(csvEscape).join(',')
      )
    })
    return '\uFEFF' + lines.join('\n')
  }

  if (series && series.kpi != null) {
    lines.push('label,kpi')
    lines.push([series.label ?? 'kpi', series.kpi].map(csvEscape).join(','))
    return '\uFEFF' + lines.join('\n')
  }

  return '\uFEFFempty\n'
}

export function downloadCsv(csv: string, filename = 'chart.csv') {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function downloadChartResult(input: ChartDownloadInput) {
  downloadCsv(chartResultToCsv(input), input.filename || 'chart.csv')
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  const need = /[",\n\r]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return need ? `"${escaped}"` : escaped
}
