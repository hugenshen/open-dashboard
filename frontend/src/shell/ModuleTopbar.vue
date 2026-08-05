<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { authApi, type MenuItem } from '../api/auth'

const props = defineProps<{
  module?: 'datasources' | 'datasets' | 'dashboards' | 'reports' | string
}>()

const route = useRoute()

const FALLBACK: MenuItem[] = [
  { key: 'datasources', label: '数据源', path: '/datasources' },
  { key: 'datasets', label: '数据集', path: '/datasets' },
  { key: 'dashboards', label: '仪表盘', path: '/dashboards' },
  { key: 'reports', label: '报告', path: '/reports' }
]

const items = ref<MenuItem[]>(FALLBACK)
const displayName = ref('')

const active = computed(() => {
  if (props.module) return props.module
  const p = route.path
  const hit = items.value.find((m) => p === m.path || p.startsWith(m.path + '/'))
  return hit?.key || 'dashboards'
})

onMounted(async () => {
  try {
    items.value = await authApi.menus()
  } catch {
    items.value = FALLBACK
  }
  try {
    const me = await authApi.me()
    displayName.value = me.displayName || me.userId
  } catch {
    displayName.value = ''
  }
})
</script>

<template>
  <header class="app-nav">
    <div class="nav-left">
      <router-link class="brand" to="/dashboards" aria-label="Open Dashboard 首页">
        <span class="logo" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1.5" y="1.5" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.95" />
            <rect x="10" y="1.5" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.55" />
            <rect x="1.5" y="10" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.55" />
            <rect x="10" y="10" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.3" />
          </svg>
        </span>
        <span class="brand-text">Open Dashboard</span>
      </router-link>

      <nav class="primary" aria-label="主导航">
        <router-link
          v-for="item in items"
          :key="item.key"
          :to="item.path"
          class="nav-item"
          :class="{ on: active === item.key }"
        >
          {{ item.label }}
        </router-link>
      </nav>
    </div>
    <div v-if="displayName" class="nav-right" :title="displayName">
      <span class="user-chip">{{ displayName }}</span>
    </div>
  </header>
</template>

<style scoped>
.app-nav {
  --nav-ink: #1f2329;
  --nav-muted: #646a73;
  --nav-line: rgba(31, 35, 41, 0.08);
  --nav-primary: #3370ff;
  --nav-primary-soft: #eaefff;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 0 12px;
  background: #fff;
  border-bottom: 1px solid var(--nav-line);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 40;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
}

.nav-right {
  flex-shrink: 0;
  margin-left: 12px;
}

.user-chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--nav-muted);
  background: rgba(31, 35, 41, 0.04);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--nav-ink);
  flex-shrink: 0;
  padding: 4px 6px;
  border-radius: 8px;
}

.brand:hover {
  background: rgba(31, 35, 41, 0.04);
}

.logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, #3370ff 0%, #245bdb 100%);
  box-shadow: 0 1px 2px rgba(51, 112, 255, 0.28);
}

.brand-text {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.primary {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.nav-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--nav-muted);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.15s ease, background 0.15s ease;
}

.nav-item:hover {
  color: var(--nav-ink);
  background: rgba(31, 35, 41, 0.04);
}

.nav-item.on {
  color: var(--nav-primary);
  background: var(--nav-primary-soft);
  font-weight: 600;
}

@media (max-width: 720px) {
  .brand-text {
    display: none;
  }
  .nav-left {
    gap: 10px;
  }
  .nav-item {
    padding: 0 10px;
  }
}
</style>
