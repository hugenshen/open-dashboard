<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, type MenuItem } from '../api/auth'
import { conversationApi } from '../conversation/api'

const props = defineProps<{
  module?: 'datasources' | 'datasets' | 'dashboards' | 'reports' | string
  theme?: 'light' | 'dark'
}>()

const route = useRoute()
const router = useRouter()

const FALLBACK: MenuItem[] = [
  { key: 'workbench', label: '工作台', path: '/workbench' },
  { key: 'conversations', label: '对话', path: '/conversations' },
  { key: 'datasources', label: '数据源', path: '/datasources' },
  { key: 'datasets', label: '数据集', path: '/datasets' },
  { key: 'dashboards', label: '仪表盘', path: '/dashboards' },
  { key: 'reports', label: '报告', path: '/reports' }
]

const items = ref<MenuItem[]>(FALLBACK)
const displayName = ref('')
const sqlbotEnabled = ref(false)
const sqlbotOpen = ref(false)

const SQLBOT_OPEN_KEY = 'od.sqlbot.open'

const isDashEditor = computed(() => /\/dashboards\/[^/]+\/edit\/?$/.test(route.path))

function onSqlbotSet(ev: Event) {
  const open = Boolean((ev as CustomEvent<{ open?: boolean }>).detail?.open)
  sqlbotOpen.value = open
}

function toggleSqlbot() {
  if (isDashEditor.value) {
    const next = sessionStorage.getItem(SQLBOT_OPEN_KEY) !== '1'
    sessionStorage.setItem(SQLBOT_OPEN_KEY, next ? '1' : '0')
    sqlbotOpen.value = next
    window.dispatchEvent(new CustomEvent('od:sqlbot-set', { detail: { open: next } }))
    return
  }
  router.push('/conversations')
}

const active = computed(() => {
  if (props.module) return props.module
  const p = route.path
  const hit = items.value.find((m) => p === m.path || p.startsWith(m.path + '/'))
  return hit?.key || 'workbench'
})

onMounted(async () => {
  try {
    const remote = await authApi.menus()
    if (remote?.length) {
      // ensure workbench stays first if backend is older
      const hasWb = remote.some((m) => m.key === 'workbench')
      items.value = hasWb ? remote : [FALLBACK[0], ...remote]
    } else {
      items.value = FALLBACK
    }
  } catch {
    items.value = FALLBACK
  }
  try {
    const me = await authApi.me()
    displayName.value = decodeDisplayName(me.displayName || me.userId)
  } catch {
    displayName.value = ''
  }
  try {
    const feat = await conversationApi.feature()
    sqlbotEnabled.value = !!feat.enabled
  } catch {
    sqlbotEnabled.value = false
  }
  sqlbotOpen.value = false
  sessionStorage.setItem(SQLBOT_OPEN_KEY, '0')
  window.addEventListener('od:sqlbot-set', onSqlbotSet)
})

onUnmounted(() => {
  window.removeEventListener('od:sqlbot-set', onSqlbotSet)
})

/** Backend may echo percent-encoded X-User-Name until header decode is deployed. */
function decodeDisplayName(raw: string) {
  if (!raw.includes('%')) return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
</script>

<template>
  <header class="app-nav" :class="{ dark: theme !== 'light' }">
    <div class="nav-left">
      <router-link class="brand" to="/workbench" aria-label="Open Dashboard 首页">
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
    <div class="nav-right">
      <button
        v-if="sqlbotEnabled"
        type="button"
        class="sqlbot-link"
        :class="{ on: sqlbotOpen || route.path.startsWith('/conversations') }"
        title="SQLBot 问数"
        aria-label="打开 SQLBot"
        @click="toggleSqlbot"
      >
        <svg width="18" height="18" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <path
            d="M15 3.8C8.11 3.8 2.53 9.08 2.53 15.97C2.53 22.86 8.11 26.2 15 26.2C21.89 26.2 27.47 22.86 27.47 15.97C27.47 9.08 21.89 3.8 15 3.8ZM18.03 21.13H11.97C10.38 21.13 8.85 20.49 7.72 19.36C6.59 18.24 5.96 16.71 5.96 15.11C5.96 13.52 6.59 11.99 7.72 10.86C8.85 9.73 10.38 9.1 11.97 9.1H18.03C19.62 9.1 21.15 9.73 22.28 10.86C23.41 11.99 24.04 13.52 24.04 15.11C24.04 16.71 23.41 18.24 22.28 19.36C21.15 20.49 19.62 21.13 18.03 21.13Z"
            fill="#1cba90"
          />
          <path d="M10.55 14.92H8.77V18.79H10.55V14.92Z" fill="#fff" />
          <path d="M14.12 13.19H12.34V18.79H14.12V13.19Z" fill="#fff" />
          <path d="M17.69 15.44H15.91V18.79H17.69V15.44Z" fill="#fff" />
          <path d="M21.23 12.45H19.45V18.79H21.23V12.45Z" fill="#fff" />
        </svg>
        <span>SQLBot</span>
      </button>
      <a
        class="help-link"
        href="/help/"
        target="_blank"
        rel="noopener noreferrer"
        title="用户操作手册"
        aria-label="打开用户操作手册"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.4" />
          <path
            d="M6.35 6.2c0-1.05.8-1.85 1.85-1.85s1.85.8 1.85 1.85c0 .7-.35 1.15-.95 1.5-.55.3-.9.55-.9 1.15v.35"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
          <circle cx="8" cy="11.35" r="0.85" fill="currentColor" />
        </svg>
        <span>帮助</span>
      </a>
      <span v-if="displayName" class="user-chip" :title="displayName">{{ displayName }}</span>
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
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 12px;
}

.help-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--nav-muted);
  text-decoration: none;
  transition: color 0.15s ease, background 0.15s ease;
}

.sqlbot-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px;
  font-weight: 600;
  color: #1cba90;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.sqlbot-link:hover,
.sqlbot-link.on {
  background: rgba(28, 186, 144, 0.14);
}

.sqlbot-link svg {
  display: block;
  flex-shrink: 0;
}

.help-link:hover {
  color: var(--nav-ink);
  background: rgba(31, 35, 41, 0.04);
  text-decoration: none;
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

.app-nav.dark {
  height: 48px;
  --nav-ink: #fff;
  --nav-muted: #c9cdd4;
  --nav-line: rgba(255, 255, 255, 0.08);
  --nav-primary-soft: rgba(51, 112, 255, 0.28);
  background: #1a1d24;
}

.app-nav.dark .brand:hover,
.app-nav.dark .nav-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.app-nav.dark .logo {
  background: #3370ff;
  box-shadow: none;
}

.app-nav.dark .nav-item.on {
  color: #fff;
}

.app-nav.dark .help-link:hover {
  background: rgba(255, 255, 255, 0.08);
}

.app-nav.dark .sqlbot-link {
  color: #3dd6a8;
}

.app-nav.dark .sqlbot-link:hover,
.app-nav.dark .sqlbot-link.on {
  background: rgba(28, 186, 144, 0.2);
}

.app-nav.dark .user-chip {
  color: #dfe1e5;
  background: rgba(255, 255, 255, 0.08);
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
