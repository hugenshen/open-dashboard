<script setup lang="ts">
import { useRouter } from 'vue-router'
import { clearAuthHeaders } from '../../api/http'

const router = useRouter()

async function relogin() {
  clearAuthHeaders()
  await router.replace('/login')
}
</script>

<template>
  <main class="forbidden-page">
    <section>
      <div class="code">403</div>
      <h1>没有访问权限</h1>
      <p>当前账号没有进入该管理页面所需的工作区角色。请切换到管理员账号，或联系工作区管理员开通权限。</p>
      <div class="actions">
        <router-link to="/workbench">回到工作台</router-link>
        <button type="button" @click="relogin">切换账号</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.forbidden-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background: #f6f7fb;
  color: #111827;
}

section {
  width: min(520px, 100%);
  border: 1px solid #dfe3ea;
  border-radius: 12px;
  background: #fff;
  padding: 30px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(17, 24, 39, 0.1);
}

.code {
  color: #4f46e5;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

h1 {
  margin: 8px 0 10px;
  font-size: 28px;
}

p {
  margin: 0;
  color: #4b5563;
  line-height: 1.7;
}

.actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 22px;
  flex-wrap: wrap;
}

a,
button {
  min-height: 38px;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #fff;
  padding: 8px 14px;
  color: #111827;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

button {
  border-color: #4f46e5;
  background: #4f46e5;
  color: #fff;
}
</style>
