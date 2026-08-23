<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, type SsoProvider } from '../../api/auth'
import DataQMark from '../../shell/DataQMark.vue'

const router = useRouter()
const route = useRoute()

const mode = ref<'platform' | 'workspace' | 'analyst'>('platform')
const account = ref('demo')
const password = ref('demo123456')
const error = ref('')
const submitting = ref(false)
const providers = ref<SsoProvider[]>([])
const loadingProviders = ref(false)

const redirect = computed(() => {
  const raw = route.query.redirect
  return typeof raw === 'string' && raw.startsWith('/') ? raw : '/workbench'
})

const loggedOut = computed(() => route.query.logged_out === '1')
const expired = computed(() => route.query.expired === '1')
const ssoError = computed(() => route.query.sso_error === '1')
const readyProviders = computed(() => providers.value.filter((p) => p.ready))
const registerTo = computed(() => ({
  path: '/register',
  query: { redirect: redirect.value }
}))

async function login() {
  error.value = ''
  if (!account.value.trim()) {
    error.value = '请输入账号'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    return
  }
  submitting.value = true
  try {
    await authApi.login({ username: account.value.trim(), password: password.value })
    await router.replace(redirect.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败'
  } finally {
    submitting.value = false
  }
}

function fillDemo(next: 'platform' | 'workspace' | 'analyst') {
  mode.value = next
  if (next === 'platform') {
    account.value = 'demo'
    password.value = 'demo123456'
  } else if (next === 'workspace') {
    account.value = 'wsadmin'
    password.value = 'wsadmin123456'
  } else {
    account.value = 'analyst'
    password.value = 'analyst123456'
  }
}

function startSso(provider: SsoProvider) {
  if (!provider.ready) return
  window.location.href = `/api/auth/sso/${encodeURIComponent(provider.id)}/start?redirect=${encodeURIComponent(redirect.value)}`
}

onMounted(async () => {
  loadingProviders.value = true
  try {
    providers.value = await authApi.ssoProviders()
  } catch {
    providers.value = []
  } finally {
    loadingProviders.value = false
  }
})
</script>

<template>
  <main class="auth-page">
    <aside class="auth-rail" aria-hidden="true">
      <div class="auth-brand">
        <DataQMark class="brand-mark" />
        <span>DataQ</span>
      </div>
      <div class="auth-hero">
        <div class="auth-copy">
          <h1>问数成图，一语成板</h1>
          <p>用自然语言查数据、生成仪表盘；同一身份进入分析与治理。</p>
        </div>
        <ul class="auth-points">
          <li>
            <strong>问数</strong>
            <span>数据集权限内直接出表出图</span>
          </li>
          <li>
            <strong>成板</strong>
            <span>一句话生成可编辑仪表盘</span>
          </li>
          <li>
            <strong>协作</strong>
            <span>按工作区与角色管控数据</span>
          </li>
        </ul>
      </div>
    </aside>

    <section class="auth-main">
      <div class="auth-card">
        <p v-if="loggedOut" class="notice">已退出登录</p>
        <p v-if="expired" class="notice warn">登录状态已失效，请重新登录</p>
        <p v-if="ssoError" class="notice warn">企业 SSO 未完成，请重试或改用账号密码</p>

        <h2>登录</h2>
        <p class="sub">欢迎回来，请输入账号继续。</p>

        <div v-if="readyProviders.length || loadingProviders" class="sso">
          <button
            v-for="provider in readyProviders"
            :key="provider.id"
            type="button"
            class="ghost"
            @click="startSso(provider)"
          >
            使用 {{ provider.label }} 登录
          </button>
          <p v-if="loadingProviders && !readyProviders.length" class="muted">正在检查企业登录…</p>
          <div v-if="readyProviders.length" class="split"><span>或使用账号密码</span></div>
        </div>

        <form @submit.prevent="login">
          <label class="field">
            <span>账号</span>
            <input v-model="account" autocomplete="username" placeholder="用户名" />
          </label>
          <label class="field">
            <span>密码</span>
            <input
              v-model="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              type="password"
            />
          </label>
          <p v-if="error" class="error">{{ error }}</p>
          <button class="primary" type="submit" :disabled="submitting">
            {{ submitting ? '登录中…' : '登录' }}
          </button>
        </form>

        <p class="foot">
          还没有账号？
          <RouterLink :to="registerTo">立即注册</RouterLink>
        </p>

        <details class="demo">
          <summary>演示账号一键填入</summary>
          <div class="demo-row">
            <button type="button" :class="{ on: mode === 'platform' }" @click="fillDemo('platform')">
              超级管理员
            </button>
            <button type="button" :class="{ on: mode === 'workspace' }" @click="fillDemo('workspace')">
              工作区管理员
            </button>
            <button type="button" :class="{ on: mode === 'analyst' }" @click="fillDemo('analyst')">
              分析师
            </button>
          </div>
        </details>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(420px, 1fr);
  color: #111827;
  background: #f6f7fb;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
}

.auth-rail {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 40px 48px 48px;
  border-right: 1px solid #e5e7eb;
  background:
    radial-gradient(circle at 18% 12%, rgba(79, 70, 229, 0.14), transparent 42%),
    linear-gradient(160deg, #eef2ff 0%, #f8fafc 48%, #ffffff 100%);
}

.auth-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 720;
  letter-spacing: -0.02em;
}

.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  object-position: 18% 78%;
  display: block;
}

.auth-hero {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 28px;
  max-width: 420px;
  min-height: 0;
  padding: 32px 0;
}

.auth-copy h1 {
  margin: 0;
  font-size: clamp(28px, 3.2vw, 36px);
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.25;
}

.auth-copy p {
  margin: 14px 0 0;
  color: #4b5563;
  font-size: 15px;
  line-height: 1.7;
}

.auth-points {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.auth-points li {
  display: grid;
  grid-template-columns: 3em 1fr;
  gap: 12px;
  align-items: baseline;
  padding: 12px 14px;
  border: 1px solid rgba(79, 70, 229, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
}

.auth-points strong {
  color: #111827;
  font-size: 13px;
  font-weight: 700;
}

.auth-points span {
  color: #4b5563;
  font-size: 13.5px;
  line-height: 1.55;
}

.auth-main {
  display: grid;
  place-items: center;
  padding: 40px 28px;
  background: #fff;
}

.auth-card {
  width: min(400px, 100%);
}

.auth-card h2 {
  margin: 0;
  font-size: 26px;
  font-weight: 740;
  letter-spacing: -0.02em;
}

.sub {
  margin: 8px 0 0;
  color: #6b7280;
  font-size: 14px;
  line-height: 1.5;
}

.notice {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid #bbf7d0;
  border-radius: 10px;
  background: #f0fdf4;
  color: #047857;
  font-size: 13px;
  line-height: 1.45;
}

.notice.warn {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #9a3412;
}

.sso {
  margin-top: 22px;
  display: grid;
  gap: 10px;
}

.muted {
  margin: 0;
  color: #9ca3af;
  font-size: 13px;
}

.split {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 0 2px;
  color: #9ca3af;
  font-size: 12px;
}

.split::before,
.split::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e5e7eb;
}

.split span {
  white-space: nowrap;
}

form {
  display: grid;
  gap: 14px;
  margin-top: 22px;
}

.field span {
  display: block;
  margin-bottom: 7px;
  font-size: 13px;
  font-weight: 650;
  color: #374151;
}

input {
  width: 100%;
  box-sizing: border-box;
  height: 44px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f9fafb;
  padding: 0 14px;
  font: inherit;
  color: #111827;
  outline: none;
  transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
}

input:hover {
  border-color: #d1d5db;
}

input:focus {
  border-color: #a5b4fc;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.14);
}

button {
  font: inherit;
  cursor: pointer;
}

.primary,
.ghost {
  width: 100%;
  height: 44px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 650;
}

.primary {
  margin-top: 4px;
  border: 0;
  background: #4f46e5;
  color: #fff;
}

.primary:hover:not(:disabled) {
  background: #4338ca;
}

.primary:disabled {
  opacity: 0.7;
  cursor: wait;
}

.ghost {
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #111827;
}

.ghost:hover {
  background: #f9fafb;
}

.error {
  margin: 0;
  color: #b42318;
  font-size: 13px;
}

.foot {
  margin: 18px 0 0;
  text-align: center;
  color: #6b7280;
  font-size: 14px;
}

.foot a {
  margin-left: 4px;
  color: #4f46e5;
  font-weight: 650;
  text-decoration: none;
}

.foot a:hover {
  text-decoration: underline;
}

.demo {
  margin-top: 28px;
  padding-top: 16px;
  border-top: 1px solid #f3f4f6;
  color: #9ca3af;
  font-size: 12.5px;
}

.demo summary {
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.demo summary::-webkit-details-marker {
  display: none;
}

.demo summary:hover {
  color: #6b7280;
}

.demo-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.demo-row button {
  height: 30px;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  background: #fff;
  color: #4b5563;
  font-size: 12px;
  font-weight: 550;
}

.demo-row button:hover,
.demo-row button.on {
  border-color: #c7d2fe;
  background: #eef2ff;
  color: #4338ca;
}

@media (max-width: 860px) {
  .auth-page {
    grid-template-columns: 1fr;
  }

  .auth-rail {
    min-height: 0;
    border-right: 0;
    border-bottom: 1px solid #e5e7eb;
    padding: 24px 24px 20px;
  }

  .auth-hero {
    flex: none;
    padding: 16px 0 0;
    gap: 0;
  }

  .auth-copy h1 {
    font-size: 24px;
  }

  .auth-points {
    display: none;
  }

  .auth-main {
    padding: 28px 20px 40px;
    background: #f6f7fb;
  }

  .auth-card {
    padding: 24px;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    background: #fff;
    box-shadow: 0 12px 40px rgba(17, 24, 39, 0.06);
  }
}
</style>
