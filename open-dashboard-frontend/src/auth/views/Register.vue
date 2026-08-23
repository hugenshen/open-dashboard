<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi } from '../../api/auth'
import DataQMark from '../../shell/DataQMark.vue'

const router = useRouter()
const route = useRoute()

const username = ref('')
const displayName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const submitting = ref(false)

const redirect = computed(() => {
  const raw = route.query.redirect
  return typeof raw === 'string' && raw.startsWith('/') ? raw : '/workbench'
})

const loginTo = computed(() => ({
  path: '/login',
  query: { redirect: redirect.value }
}))

async function register() {
  error.value = ''
  const account = username.value.trim()
  if (!account) {
    error.value = '请输入账号'
    return
  }
  if (password.value.length < 8) {
    error.value = '密码至少 8 位'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  submitting.value = true
  try {
    await authApi.register({
      username: account,
      password: password.value,
      displayName: displayName.value.trim() || account,
      email: email.value.trim() || undefined
    })
    await router.replace(redirect.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '注册失败'
  } finally {
    submitting.value = false
  }
}
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
          <h1>创建账号，开始分析</h1>
          <p>注册后默认以分析师身份进入用户使用端，可在数据广场申请可用数据。</p>
        </div>
      </div>
    </aside>

    <section class="auth-main">
      <div class="auth-card">
        <h2>注册</h2>
        <p class="sub">填写基本信息，创建你的工作区账号。</p>

        <form @submit.prevent="register">
          <label class="field">
            <span>账号</span>
            <input v-model="username" autocomplete="username" placeholder="例如 zhangsan" />
          </label>
          <label class="field">
            <span>姓名</span>
            <input v-model="displayName" autocomplete="name" placeholder="用于成员展示" />
          </label>
          <label class="field">
            <span>邮箱 <em>可选</em></span>
            <input v-model="email" autocomplete="email" placeholder="name@company.com" type="email" />
          </label>
          <label class="field">
            <span>密码</span>
            <input v-model="password" autocomplete="new-password" placeholder="至少 8 位" type="password" />
          </label>
          <label class="field">
            <span>确认密码</span>
            <input
              v-model="confirmPassword"
              autocomplete="new-password"
              placeholder="再次输入密码"
              type="password"
            />
          </label>
          <p v-if="error" class="error">{{ error }}</p>
          <button class="primary" type="submit" :disabled="submitting">
            {{ submitting ? '注册中…' : '注册并进入' }}
          </button>
        </form>

        <p class="foot">
          已有账号？
          <RouterLink :to="loginTo">返回登录</RouterLink>
        </p>
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
  max-width: 420px;
  min-height: 0;
  padding: 32px 0;
}

.auth-copy h1 {
  margin: 0;
  font-size: clamp(28px, 3.2vw, 36px);
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.auth-copy p {
  margin: 14px 0 0;
  color: #4b5563;
  font-size: 15px;
  line-height: 1.65;
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

form {
  display: grid;
  gap: 14px;
  margin-top: 22px;
}

.field span {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 7px;
  font-size: 13px;
  font-weight: 650;
  color: #374151;
}

.field em {
  font-style: normal;
  font-weight: 500;
  color: #9ca3af;
  font-size: 12px;
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

.primary {
  width: 100%;
  height: 44px;
  margin-top: 4px;
  border: 0;
  border-radius: 10px;
  background: #4f46e5;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}

.primary:hover:not(:disabled) {
  background: #4338ca;
}

.primary:disabled {
  opacity: 0.7;
  cursor: wait;
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
  }

  .auth-copy h1 {
    font-size: 24px;
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
