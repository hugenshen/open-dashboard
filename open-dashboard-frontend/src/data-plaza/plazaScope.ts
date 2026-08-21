import { ref } from 'vue'

/** Shared by AppShell top switch and DataPlaza list filters (Quick BI-style 我的 / 企业). */
export type PlazaScope = 'org' | 'mine'

export const plazaScope = ref<PlazaScope>('org')

export function setPlazaScope(scope: PlazaScope) {
  plazaScope.value = scope
}
