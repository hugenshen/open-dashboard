import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { setDashboardHttpClient } from './api/dashboard'
import { apiFetch } from './api/http'
import './styles.css'

setDashboardHttpClient(async ({ method, url, data, params }) =>
  apiFetch(url, { method, data, params })
)

createApp(App).use(createPinia()).use(router).mount('#app')
