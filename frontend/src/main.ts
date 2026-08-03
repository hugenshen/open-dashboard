import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { setDashboardHttpClient } from './api/dashboard'
import './styles.css'

setDashboardHttpClient(async ({ method, url, data, params }) => {
  const qs = params ? `?${new URLSearchParams(params)}` : ''
  const res = await fetch(`/api${url}${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(data ?? {})
  })
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}`)
  }
  if (res.status === 204) return undefined as never
  return res.json()
})

createApp(App).use(createPinia()).use(router).mount('#app')
