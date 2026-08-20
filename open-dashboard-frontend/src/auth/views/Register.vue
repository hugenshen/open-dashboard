<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi } from '../../api/auth'

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
    <section class="auth-card">
      <div class="brand">
        <i>OD</i>
        <span>Open Dashboard</span>
      </div>
      <h1>创建工作区账号</h1>
      <p class="sub">注册后默认加入零售经营项目组，以分析师权限进入用户使用端。</p>
      <p class="auth-linkline">已有账号？<RouterLink :to="loginTo">返回登录</RouterLink></p>

      <form @submit.prevent="register">
        <label>
          <span>账号</span>
          <input v-model="username" autocomplete="username" placeholder="例如 zhangsan" />
        </label>
        <label>
          <span>姓名</span>
          <input v-model="displayName" autocomplete="name" placeholder="用于工作区成员展示" />
        </label>
        <label>
          <span>邮箱</span>
          <input v-model="email" autocomplete="email" placeholder="用于后续企业 SSO 绑定" type="email" />
        </label>
        <label>
          <span>密码</span>
          <input v-model="password" autocomplete="new-password" placeholder="至少 8 位" type="password" />
        </label>
        <label>
          <span>确认密码</span>
          <input v-model="confirmPassword" autocomplete="new-password" placeholder="再次输入密码" type="password" />
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="primary" type="submit" :disabled="submitting">
          {{ submitting ? '注册中...' : '注册并进入' }}
        </button>
      </form>

      <div class="tips">
        <b>权限说明</b>
        <span>新注册用户不会获得管理端菜单；数据消费通过数据广场申请或被管理员加入项目组后生效。</span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background:
    linear-gradient(180deg, rgba(79, 70, 229, 0.08), transparent 34%),
    #f6f7fb;
  color: #111827;
}

.auth-card {
  width: min(460px, 100%);
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
.auth-linkline {
  color: #4b5563;
  line-height: 1.65;
}

.auth-linkline {
  margin: 10px 0 20px;
  font-size: 14px;
}

.auth-linkline a {
  margin-left: 4px;
  color: #4f46e5;
  font-weight: 800;
  text-decoration: none;
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

.primary:disabled {
  opacity: 0.68;
  cursor: wait;
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
