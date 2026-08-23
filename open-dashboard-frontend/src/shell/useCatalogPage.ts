import { computed, ref, watch, type Ref } from 'vue'

export const CATALOG_PAGE_SIZE = 10

export function useCatalogPage<T>(source: Ref<T[]>) {
  const page = ref(1)
  const total = computed(() => source.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / CATALOG_PAGE_SIZE) || 1))
  const paged = computed(() => {
    const p = Math.min(Math.max(1, page.value), pageCount.value)
    const start = (p - 1) * CATALOG_PAGE_SIZE
    return source.value.slice(start, start + CATALOG_PAGE_SIZE)
  })
  const rangeLabel = computed(() => {
    if (!total.value) return '0'
    const p = Math.min(Math.max(1, page.value), pageCount.value)
    const start = (p - 1) * CATALOG_PAGE_SIZE + 1
    const end = Math.min(p * CATALOG_PAGE_SIZE, total.value)
    return `${start}–${end}`
  })
  const pageNumbers = computed(() => {
    const count = pageCount.value
    const cur = Math.min(Math.max(1, page.value), count)
    if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
    const set = new Set<number>([1, count, cur - 1, cur, cur + 1])
    if (cur <= 3) [2, 3, 4].forEach((n) => set.add(n))
    if (cur >= count - 2) [count - 3, count - 2, count - 1].forEach((n) => set.add(n))
    return [...set].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b)
  })

  watch(total, () => {
    if (page.value > pageCount.value) page.value = pageCount.value
  })

  function resetPage() {
    page.value = 1
  }

  function goPage(n: number) {
    page.value = Math.min(Math.max(1, n), pageCount.value)
  }

  return {
    page,
    pageCount,
    pageNumbers,
    total,
    paged,
    rangeLabel,
    pageSize: CATALOG_PAGE_SIZE,
    resetPage,
    goPage
  }
}
