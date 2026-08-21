<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, type SsoProvider } from '../../api/auth'

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

function usePlatform() {
  mode.value = 'platform'
  account.value = 'demo'
  password.value = 'demo123456'
}

function useWorkspaceAdmin() {
  mode.value = 'workspace'
  account.value = 'wsadmin'
  password.value = 'wsadmin123456'
}

function useAnalyst() {
  mode.value = 'analyst'
  account.value = 'analyst'
  password.value = 'analyst123456'
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
  <main class="login-page">
    <section class="login-card">
      <div class="brand">
        <i>OD</i>
        <span>Open Dashboard</span>
      </div>
      <p v-if="loggedOut" class="notice">已退出登录</p>
      <p v-if="expired" class="notice warn">登录状态已失效，请重新登录</p>
      <p v-if="ssoError" class="notice warn">企业 SSO 登录未完成，请重试或改用账号密码登录</p>
      <h1>登录</h1>
      <p class="sub">登录后按权限进入用户使用端或管理端。工作区只出现在管理端。</p>
      <p class="auth-linkline">新用户还没有账号？<RouterLink :to="registerTo">立即注册</RouterLink></p>

      <div class="sso" v-if="readyProviders.length || loadingProviders">
        <button
          v-for="provider in readyProviders"
          :key="provider.id"
          type="button"
          class="sso-btn"
          @click="startSso(provider)"
        >
          <span>{{ provider.id === 'google' ? 'G' : provider.label.slice(0, 1).toUpperCase() }}</span>
          使用 {{ provider.label }} 登录
        </button>
        <p v-if="loadingProviders && !readyProviders.length">正在检查企业登录方式...</p>
      </div>

      <div class="segments" role="tablist" aria-label="演示账号类型">
        <button type="button" :class="{ on: mode === 'platform' }" @click="usePlatform">超级管理员</button>
        <button type="button" :class="{ on: mode === 'workspace' }" @click="useWorkspaceAdmin">工作区管理员</button>
        <button type="button" :class="{ on: mode === 'analyst' }" @click="useAnalyst">分析师</button>
      </div>

      <form @submit.prevent="login">
        <label>
          <span>账号</span>
          <input v-model="account" autocomplete="username" placeholder="demo" />
        </label>
        <label>
          <span>密码</span>
          <input v-model="password" autocomplete="current-password" placeholder="demo123456" type="password" />
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="primary" type="submit" :disabled="submitting">
          {{ submitting ? '登录中...' : '登录' }}
        </button>
      </form>

      <div class="tips">
        <b>演示权限</b>
        <span v-if="mode === 'platform'">超级管理员可治理全部工作区；工作区切换只出现在管理端。</span>
        <span v-else-if="mode === 'workspace'">工作区管理员通常只管理 1～2 个工作区；用户端没有工作区概念。</span>
        <span v-else>分析师只进入工作台、数据广场、对话分析、仪表盘和报告。</span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background:
    linear-gradient(180deg, rgba(79, 70, 229, 0.08), transparent 34%),
    #f6f7fb;
  color: #111827;
}

.login-card {
  width: min(480px, 100%);
  border: 1px solid #dfe3ea;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(17, 24, 39, 0.12);
  padding: 28px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
  font-weight: 750;
}

.brand i {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: #4f46e5;
  color: #fff;
  font-style: normal;
  font-size: 11px;
}

h1 {
  margin: 0 0 8px;
  font-size: 28px;
  line-height: 1.15;
}

.sub,
.tips,
.notice,
.auth-linkline {
  color: #4b5563;
  line-height: 1.65;
}

.auth-linkline {
  margin: 10px 0 0;
  font-size: 14px;
}

.auth-linkline a {
  margin-left: 4px;
  color: #4f46e5;
  font-weight: 800;
  text-decoration: none;
}

.notice {
  margin: 0 0 12px;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  background: #f0fdf4;
  color: #047857;
  padding: 8px 10px;
  font-size: 13px;
}

.notice.warn {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #9a3412;
}

.segments {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  margin: 22px 0 16px;
  padding: 4px;
  border-radius: 10px;
  background: #f3f4f6;
}

.segments button {
  font-size: 13px;
  padding: 0 8px;
}

.sso {
  display: grid;
  gap: 10px;
  margin: 20px 0 14px;
}

.sso p {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
}

.sso-btn {
  justify-content: center;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  border-color: #d8dde7;
  background: #fff;
  color: #111827;
}

.sso-btn span {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #eef2ff;
  color: #4338ca;
  font-weight: 800;
  font-size: 13px;
}

button,
input {
  font: inherit;
}

button {
  min-height: 38px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #4b5563;
  font-weight: 700;
  cursor: pointer;
}

.segments button.on {
  background: #fff;
  color: #3730a3;
  border-color: #dfe3ea;
}

form {
  display: grid;
  gap: 14px;
}

label span {
  display: block;
  margin-bottom: 7px;
  font-size: 13px;
  font-weight: 700;
}

input {
  width: 100%;
  box-sizing: border-box;
  height: 42px;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #f7f8fc;
  padding: 0 12px;
}

input:focus {
  outline: 3px solid rgba(79, 70, 229, 0.22);
  border-color: #4f46e5;
  background: #fff;
}

.primary {
  min-height: 42px;
  background: #4f46e5;
  color: #fff;
}

.primary:hover {
  background: #4338ca;
}

.error {
  margin: -2px 0;
  color: #b42318;
  font-size: 13px;
}

.tips {
  margin-top: 18px;
  border-top: 1px solid #e5e7eb;
  padding-top: 14px;
  font-size: 13px;
}

.tips b,
.tips span {
  display: block;
}
</style>
