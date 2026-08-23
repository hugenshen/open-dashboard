export const THEME_KEY = 'od.theme'
export const RAIL_KEY = 'od.rail.slim'

export type OdTheme = 'light' | 'dark-rail' | 'dark'
export type OdBrand = 'indigo' | 'feishu' | 'tabler' | 'teal'

export const THEMES: Array<{ id: OdTheme; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'dark-rail', label: '深色侧栏' },
  { id: 'dark', label: '深色' }
]

export const BRANDS: Array<{ id: OdBrand; label: string }> = [
  { id: 'indigo', label: 'Indigo' },
  { id: 'feishu', label: '飞书蓝' },
  { id: 'tabler', label: 'Tabler 蓝' },
  { id: 'teal', label: '青绿' }
]

export const BRAND_KEY = 'od.brand'

export function readTheme(): OdTheme {
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'dark-rail' || t === 'dark') return t
  } catch {
    /* private mode */
  }
  return 'light'
}

export function applyTheme(id: OdTheme) {
  const theme = THEMES.some((x) => x.id === id) ? id : 'light'
  document.documentElement.dataset.odTheme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* private mode */
  }
  document.querySelectorAll('iframe').forEach((frame) => {
    try {
      if (frame.contentDocument) frame.contentDocument.documentElement.dataset.odTheme = theme
    } catch {
      /* cross-origin */
    }
  })
}

export function readRailSlim(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeRailSlim(slim: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, slim ? 'true' : 'false')
  } catch {
    /* private mode */
  }
}

export function readBrand(): OdBrand {
  try {
    const b = localStorage.getItem(BRAND_KEY)
    if (b === 'feishu' || b === 'tabler' || b === 'teal' || b === 'indigo') return b
  } catch {
    /* private mode */
  }
  return 'indigo'
}

export function applyBrand(id: OdBrand) {
  const brand = BRANDS.some((x) => x.id === id) ? id : 'indigo'
  document.documentElement.dataset.odBrand = brand
  try {
    localStorage.setItem(BRAND_KEY, brand)
  } catch {
    /* private mode */
  }
}
