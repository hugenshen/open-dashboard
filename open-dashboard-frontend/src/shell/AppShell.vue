<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, type MenuItem } from '../api/auth'
import type { WorkspaceVO } from '../api/auth'
import { setAuthFromMe } from '../api/http'
import { conversationApi } from '../conversation/api'
import RailIcon from './RailIcon.vue'
import {
  THEMES,
  applyTheme,
  readRailSlim,
  readTheme,
  writeRailSlim,
  type OdTheme
} from './theme'
import './app-shell.css'

const route = useRoute()
const router = useRouter()

const items = ref<MenuItem[]>([])
const menuError = ref('')
const displayName = ref('演示账号')
const workspaceId = ref('workspace-retail')
const workspaces = ref<WorkspaceVO[]>([])
const sqlbotEnabled = ref(false)
const sqlbotOpen = ref(false)
const theme = ref<OdTheme>(readTheme())
const userSlim = ref(readRailSlim())
const themeOpen = ref(false)
const accountOpen = ref(false)
const passwordOpen = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const SQLBOT_OPEN_KEY = 'od.sqlbot.open'

const isEditor = computed(() => route.meta.shell === 'editor')
const isConversation = computed(() => route.path.startsWith('/conversations'))
const slim = computed(() => isEditor.value || userSlim.value)
const active = computed(() => {
  const p = route.path
  const hit = items.value.find((m) => p === m.path || p.startsWith(m.path + '/'))
  return hit?.key || 'workbench'
})
const crumb = computed(() => String(route.meta.title || ''))
const bodyMod = computed(() => {
  const key = active.value
  if (key === 'conversations') return 'conversation'
  if (key === 'dataPlaza') return 'dataset'
  if (key === 'datasources') return 'datasource'
  if (key === 'datasets') return 'dataset'
  if (key === 'dashboards') return 'dashboard'
  if (key === 'reports') return 'report'
  if (key === 'workspaceAdmin') return 'dataset'
  if (key === 'dimensions') return 'dataset'
  return 'workbench'
})

const userItems = computed(() => items.value.filter((m) => (m.group || 'use') === 'use'))
const adminItems = computed(() => items.value.filter((m) => m.group === 'manage'))
const currentWorkspace = computed(
  () => workspaces.value.find((w) => w.id === workspaceId.value) || workspaces.value[0]
)

const avatarText = computed(() => {
  const n = displayName.value.trim()
  return n ? n.slice(0, 1) : '演'
})

function flash(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 1600)
}

function decodeDisplayName(raw: string) {
  if (!raw.includes('%')) return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function setTheme(id: OdTheme) {
  theme.value = id
  applyTheme(id)
  themeOpen.value = false
  const lab = THEMES.find((x) => x.id === id)?.label || ''
  flash('已切换 · ' + lab)
}

function toggleSlim() {
  if (isEditor.value) return
  userSlim.value = !userSlim.value
  writeRailSlim(userSlim.value)
}

function onSqlbotSet(ev: Event) {
  sqlbotOpen.value = Boolean((ev as CustomEvent<{ open?: boolean }>).detail?.open)
}

function toggleSqlbot() {
  const next = sessionStorage.getItem(SQLBOT_OPEN_KEY) !== '1'
  sessionStorage.setItem(SQLBOT_OPEN_KEY, next ? '1' : '0')
  sqlbotOpen.value = next
  window.dispatchEvent(new CustomEvent('od:sqlbot-set', { detail: { open: next } }))
}

function onDocClick() {
  themeOpen.value = false
  accountOpen.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  themeOpen.value = false
  accountOpen.value = false
}

function openSettings() {
  accountOpen.value = false
  passwordOpen.value = true
  oldPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
}

async function logout() {
  await authApi.logout()
  accountOpen.value = false
  await router.replace('/login?logged_out=1')
}

async function changeWorkspace(ev: Event) {
  const id = (ev.target as HTMLSelectElement).value
  try {
    const me = await authApi.switchWorkspace(id)
    setAuthFromMe(me)
    workspaceId.value = me.workspaceId
    workspaces.value = me.workspaces || workspaces.value
    flash('已切换工作区')
    window.setTimeout(() => window.location.reload(), 180)
  } catch (e) {
    flash(e instanceof Error ? e.message : '切换失败')
  }
}

async function submitPassword() {
  if (newPassword.value !== confirmPassword.value) {
    flash('两次新密码不一致')
    return
  }
  try {
    await authApi.changePassword({ oldPassword: oldPassword.value, newPassword: newPassword.value })
    passwordOpen.value = false
    flash('密码已更新')
  } catch (e) {
    flash(e instanceof Error ? e.message : '修改密码失败')
  }
}

onMounted(async () => {
  applyTheme(theme.value)
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
  window.addEventListener('od:sqlbot-set', onSqlbotSet)
  try {
    const remote = await authApi.menus()
    menuError.value = ''
    items.value = remote?.length ? remote : []
    if (!items.value.length) menuError.value = '菜单为空'
  } catch (e) {
    items.value = []
    menuError.value = e instanceof Error ? e.message : '菜单加载失败'
  }
  try {
    const me = await authApi.me()
    displayName.value = decodeDisplayName(me.displayName || me.userId) || '演示账号'
    workspaceId.value = me.workspaceId || me.currentWorkspace?.id || 'workspace-retail'
    workspaces.value = me.workspaces || (me.currentWorkspace ? [me.currentWorkspace] : [])
  } catch {
    displayName.value = '演示账号'
  }
  try {
    const feat = await conversationApi.feature()
    sqlbotEnabled.value = !!feat.enabled
  } catch {
    sqlbotEnabled.value = false
  }
  sqlbotOpen.value = sessionStorage.getItem(SQLBOT_OPEN_KEY) === '1'
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('od:sqlbot-set', onSqlbotSet)
  if (toastTimer) clearTimeout(toastTimer)
  delete document.body.dataset.mod
})

watch(
  () => route.fullPath,
  () => {
  themeOpen.value = false
  accountOpen.value = false
  passwordOpen.value = false
}
)

watch(
  bodyMod,
  (mod) => {
    document.body.dataset.mod = mod
  },
  { immediate: true }
)
</script>

<template>
  <div class="od-app" :class="{ slim, 'is-editor': isEditor, 'is-conversation': isConversation }">
    <aside class="od-rail" aria-label="产品模块">
      <router-link class="od-brand" to="/workbench" aria-label="Open Dashboard 首页">
        <i>OD</i>
        <span>Open Dashboard</span>
      </router-link>
      <nav class="od-rail-nav">
        <div v-if="menuError" class="od-rail-err" :title="menuError">{{ menuError }}</div>
        <div v-if="userItems.length" class="od-rail-label">用户使用端</div>
        <router-link
          v-for="item in userItems"
          :key="item.key"
          :to="item.path"
          class="od-rail-item"
          :class="{ on: active === item.key }"
          :title="item.label"
        >
          <RailIcon :name="item.key" />
          <span class="od-rail-txt">{{ item.label }}</span>
          <span v-if="item.key === 'conversations'" class="od-beta">内测</span>
        </router-link>
        <div v-if="adminItems.length" class="od-rail-label">管理端</div>
        <router-link
          v-for="item in adminItems"
          :key="item.key"
          :to="item.path"
          class="od-rail-item"
          :class="{ on: active === item.key }"
          :title="item.label"
        >
          <RailIcon :name="item.key" />
          <span class="od-rail-txt">{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="od-rail-foot">
        <button
          class="od-rail-item"
          type="button"
          :title="slim ? '展开侧栏' : '收起侧栏'"
          :aria-expanded="slim ? 'false' : 'true'"
          @click="toggleSlim"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 6h16M4 12h10M4 18h16" />
          </svg>
          <span class="od-rail-txt">{{ slim ? '展开侧栏' : '收起侧栏' }}</span>
        </button>
      </div>
    </aside>

    <div class="od-col">
      <header class="od-top">
        <div v-if="crumb && !isEditor" class="od-crumb">{{ crumb }}</div>
        <div class="od-top-actions">
          <label v-if="workspaces.length" class="od-workspace-switch" title="当前工作区">
            <span>{{ currentWorkspace?.role || '成员' }}</span>
            <select :value="workspaceId" @change="changeWorkspace">
              <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
                {{ ws.name }}
              </option>
            </select>
          </label>
          <!-- 产品不展示 Phase A/B/C；节点留给 editorCore 绑定，能力固定为 C -->
          <div id="phaseTabs" class="od-phase tabs" hidden aria-hidden="true">
            <button type="button" data-phase="a">Phase A</button>
            <button type="button" data-phase="b">Phase B</button>
            <button class="on" type="button" data-phase="c">Phase C</button>
          </div>
          <button
            v-if="sqlbotEnabled"
            class="od-ghost od-sqlbot"
            type="button"
            :class="{ on: sqlbotOpen }"
            title="SQLBot 问数"
            @click="toggleSqlbot"
          >
            SQLBot
          </button>
          <a class="od-ghost" href="/help/" target="_blank" rel="noopener noreferrer">帮助</a>
          <div class="od-theme-wrap" @click.stop>
            <button class="od-icon-btn" type="button" title="外观" @click="themeOpen = !themeOpen; accountOpen = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="4" />
                <path
                  d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
                />
              </svg>
            </button>
            <div class="od-pop" :class="{ open: themeOpen }">
              <button
                v-for="th in THEMES"
                :key="th.id"
                type="button"
                :aria-checked="theme === th.id ? 'true' : 'false'"
                @click="setTheme(th.id)"
              >
                {{ th.label }}
              </button>
            </div>
          </div>
          <div class="od-account-wrap" @click.stop>
            <button
              class="od-account"
              type="button"
              :aria-expanded="accountOpen ? 'true' : 'false'"
              @click="accountOpen = !accountOpen; themeOpen = false"
            >
              <span class="od-avatar">{{ avatarText }}</span>
              {{ displayName }}
            </button>
            <div class="od-pop" :class="{ open: accountOpen }">
              <div class="who">
                <b>{{ displayName }}</b>
                <span>{{ currentWorkspace?.name || '默认工作区' }}</span>
              </div>
              <button type="button" @click="flash('账号中心已连接服务端身份')">账号中心</button>
              <button type="button" @click="openSettings">修改密码</button>
              <button type="button" @click="logout">退出登录</button>
              <div class="hint">身份、工作区和权限来自服务端会话</div>
            </div>
          </div>
        </div>
      </header>
      <div class="od-stage">
        <slot />
      </div>
    </div>
    <div v-if="passwordOpen" class="od-modal-mask" @click.self="passwordOpen = false">
      <section class="od-password-modal" @click.stop>
        <h2>修改密码</h2>
        <label>
          <span>原密码</span>
          <input v-model="oldPassword" type="password" autocomplete="current-password" />
        </label>
        <label>
          <span>新密码</span>
          <input v-model="newPassword" type="password" autocomplete="new-password" />
        </label>
        <label>
          <span>确认新密码</span>
          <input v-model="confirmPassword" type="password" autocomplete="new-password" />
        </label>
        <div class="od-modal-actions">
          <button type="button" @click="passwordOpen = false">取消</button>
          <button type="button" class="primary" @click="submitPassword">保存</button>
        </div>
      </section>
    </div>
    <div class="od-toast" :class="{ show: !!toast }" role="status" aria-live="polite">{{ toast }}</div>
  </div>
</template>
