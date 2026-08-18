<script setup lang="ts">
export type CoverDomain = 'sales' | 'finance' | 'orders' | 'supply' | 'ops' | 'ask' | 'analysis'

const COVER_LABEL: Record<CoverDomain, string> = {
  sales: '销售',
  finance: '财务',
  orders: '订单',
  supply: '供应',
  ops: '运营',
  ask: '问数',
  analysis: '分析'
}

defineProps<{
  domain: CoverDomain
}>()
</script>

<template>
  <div class="cover" :class="domain">
    <span class="cover-tag">{{ COVER_LABEL[domain] }}</span>
    <svg v-if="domain === 'sales'" class="art" viewBox="0 0 200 120" fill="none" aria-hidden="true">
      <circle cx="150" cy="58" r="46" fill="rgba(79,70,229,.14)" />
      <path d="M18 86c22-10 34-34 58-38 20-3 34 12 52 8" stroke="#6366f1" stroke-width="3.2" stroke-linecap="round" />
      <circle cx="128" cy="56" r="4.5" fill="#4f46e5" />
      <ellipse cx="44" cy="100" rx="16" ry="6.5" fill="#c7d2fe" />
      <ellipse cx="44" cy="93" rx="16" ry="6.5" fill="#a5b4fc" />
      <ellipse cx="44" cy="86" rx="16" ry="6.5" fill="#818cf8" />
      <rect x="124" y="44" width="48" height="52" rx="12" fill="#fff" stroke="#4f46e5" stroke-width="2.2" />
      <path d="M136 48v-8a12 12 0 0 1 24 0v8" stroke="#4f46e5" stroke-width="2.2" stroke-linecap="round" />
      <path d="M138 68h20M138 78h14" stroke="#a5b4fc" stroke-width="2.2" stroke-linecap="round" />
    </svg>
    <svg v-else-if="domain === 'finance'" class="art" viewBox="0 0 200 120" fill="none" aria-hidden="true">
      <circle cx="46" cy="40" r="34" fill="rgba(4,120,87,.12)" />
      <rect x="18" y="52" width="78" height="50" rx="10" fill="#fff" stroke="#047857" stroke-width="2.2" />
      <rect x="18" y="52" width="78" height="16" rx="10" fill="#059669" />
      <circle cx="36" cy="84" r="7" fill="#d1fae5" stroke="#047857" stroke-width="1.6" />
      <path d="M52 80h28M52 90h18" stroke="#a7f3d0" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="148" cy="62" r="38" fill="#ecfdf5" stroke="#10b981" stroke-width="2" />
      <path d="M148 62h28a28 28 0 1 0-28-28z" fill="#34d399" />
      <circle cx="148" cy="62" r="10" fill="#fff" />
    </svg>
    <svg v-else-if="domain === 'orders'" class="art" viewBox="0 0 200 120" fill="none" aria-hidden="true">
      <circle cx="156" cy="70" r="40" fill="rgba(194,65,12,.12)" />
      <rect x="118" y="38" width="58" height="64" rx="8" fill="#fff" stroke="#c2410c" stroke-width="2.2" />
      <path d="M118 58h58" stroke="#fdba74" stroke-width="2" />
      <path d="M132 44v-8a15 15 0 0 1 30 0v8" stroke="#c2410c" stroke-width="2.2" />
      <rect x="22" y="34" width="72" height="68" rx="8" fill="#fff7ed" stroke="#ea580c" stroke-width="2.2" />
      <path d="M36 56l8 8 16-18" stroke="#ea580c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M36 78h36M36 88h24" stroke="#fdba74" stroke-width="2.2" stroke-linecap="round" />
    </svg>
    <svg v-else-if="domain === 'supply'" class="art" viewBox="0 0 200 120" fill="none" aria-hidden="true">
      <circle cx="48" cy="78" r="36" fill="rgba(29,78,216,.1)" />
      <rect x="24" y="58" width="40" height="34" rx="4" fill="#93c5fd" stroke="#1d4ed8" stroke-width="2" />
      <rect x="48" y="42" width="40" height="50" rx="4" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="2" />
      <rect x="72" y="66" width="40" height="26" rx="4" fill="#60a5fa" stroke="#1d4ed8" stroke-width="2" />
      <path d="M44 58v-8M68 42v-8M92 66v-6" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" />
      <rect x="126" y="48" width="56" height="36" rx="8" fill="#fff" stroke="#1d4ed8" stroke-width="2.2" />
      <circle cx="140" cy="92" r="10" fill="#1e3a8a" />
      <circle cx="168" cy="92" r="10" fill="#1e3a8a" />
      <path d="M126 66h56" stroke="#93c5fd" stroke-width="2" />
    </svg>
    <svg v-else-if="domain === 'ops'" class="art" viewBox="0 0 200 120" fill="none" aria-hidden="true">
      <circle cx="160" cy="36" r="28" fill="rgba(124,58,237,.12)" />
      <rect x="22" y="28" width="58" height="42" rx="10" fill="#fff" stroke="#7c3aed" stroke-width="2" />
      <rect x="88" y="28" width="42" height="42" rx="10" fill="#ede9fe" stroke="#7c3aed" stroke-width="2" />
      <rect x="22" y="78" width="42" height="26" rx="8" fill="#ddd6fe" stroke="#7c3aed" stroke-width="2" />
      <rect x="72" y="78" width="58" height="26" rx="8" fill="#fff" stroke="#7c3aed" stroke-width="2" />
      <circle cx="156" cy="78" r="26" fill="#fff" stroke="#7c3aed" stroke-width="2.2" />
      <circle cx="156" cy="78" r="8" fill="#8b5cf6" />
      <path d="M156 52v10M180 78h-10M156 104v-10M132 78h10" stroke="#c4b5fd" stroke-width="2" stroke-linecap="round" />
    </svg>
    <svg v-else-if="domain === 'ask'" class="art" viewBox="0 0 200 120" fill="none" aria-hidden="true">
      <circle cx="58" cy="40" r="30" fill="rgba(190,24,93,.1)" />
      <path d="M28 36h70a14 14 0 0 1 14 14v22a14 14 0 0 1-14 14H58l-18 14v-14H28a14 14 0 0 1-14-14V50a14 14 0 0 1 14-14z" fill="#fff" stroke="#be185d" stroke-width="2.2" />
      <circle cx="48" cy="62" r="4" fill="#f472b6" />
      <circle cx="64" cy="62" r="4" fill="#f472b6" />
      <circle cx="80" cy="62" r="4" fill="#f472b6" />
      <path d="M118 22h54a12 12 0 0 1 12 12v18a12 12 0 0 1-12 12h-10v12l-16-12h-28a12 12 0 0 1-12-12V34a12 12 0 0 1 12-12z" fill="#fdf2f8" stroke="#db2777" stroke-width="2" />
    </svg>
    <svg v-else class="art" viewBox="0 0 200 120" fill="none" aria-hidden="true">
      <circle cx="48" cy="70" r="34" fill="rgba(14,165,233,.12)" />
      <circle cx="54" cy="62" r="26" fill="#fff" stroke="#0284c7" stroke-width="2.4" />
      <circle cx="54" cy="62" r="12" fill="#e0f2fe" />
      <path d="M74 82l18 18" stroke="#0284c7" stroke-width="5" stroke-linecap="round" />
      <path d="M118 86c16-22 32-30 54-28" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" />
      <circle cx="128" cy="70" r="5" fill="#0ea5e9" />
      <circle cx="148" cy="52" r="5" fill="#0284c7" />
      <circle cx="170" cy="58" r="5" fill="#38bdf8" />
      <rect x="118" y="28" width="22" height="14" rx="4" fill="#bae6fd" />
      <rect x="148" y="22" width="18" height="14" rx="4" fill="#7dd3fc" />
    </svg>
  </div>
</template>

<style scoped>
.cover {
  height: 100px;
  position: relative;
  overflow: hidden;
  padding: 12px 14px;
}
.cover-tag {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.art {
  position: absolute;
  right: -6px;
  bottom: -10px;
  width: 78%;
  height: 118%;
  pointer-events: none;
}
.cover.sales {
  background: linear-gradient(145deg, #eef2ff, #e0e7ff);
  color: #3730a3;
}
.cover.finance {
  background: linear-gradient(145deg, #ecfdf5, #d1fae5);
  color: #047857;
}
.cover.orders {
  background: linear-gradient(145deg, #fff7ed, #ffedd5);
  color: #c2410c;
}
.cover.supply {
  background: linear-gradient(145deg, #eff6ff, #dbeafe);
  color: #1d4ed8;
}
.cover.ops {
  background: linear-gradient(145deg, #f5f3ff, #ede9fe);
  color: #6d28d9;
}
.cover.ask {
  background: linear-gradient(145deg, #fdf2f8, #fce7f3);
  color: #be185d;
}
.cover.analysis {
  background: linear-gradient(145deg, #f0f9ff, #e0f2fe);
  color: #0369a1;
}

html[data-od-theme='dark'] .cover-tag {
  background: rgba(24, 27, 34, 0.78);
}
html[data-od-theme='dark'] .cover.sales {
  background: linear-gradient(145deg, #252a46, #1e2238);
}
html[data-od-theme='dark'] .cover.finance {
  background: linear-gradient(145deg, #163028, #12241e);
}
html[data-od-theme='dark'] .cover.orders {
  background: linear-gradient(145deg, #32241a, #271c15);
}
html[data-od-theme='dark'] .cover.supply {
  background: linear-gradient(145deg, #1a2740, #152033);
}
html[data-od-theme='dark'] .cover.ops {
  background: linear-gradient(145deg, #2a2244, #221b38);
}
html[data-od-theme='dark'] .cover.ask {
  background: linear-gradient(145deg, #3a1d2e, #2c1724);
}
html[data-od-theme='dark'] .cover.analysis {
  background: linear-gradient(145deg, #163040, #122633);
}
</style>
