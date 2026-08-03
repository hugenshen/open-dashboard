import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/list' },
    {
      path: '/list',
      name: 'list',
      component: () => import('../views/list/index.vue'),
      meta: { title: '仪表盘列表' }
    },
    {
      path: '/editor/:id',
      name: 'editor',
      component: () => import('../views/editor/index.vue'),
      meta: { title: '编辑器' }
    },
    {
      path: '/preview/:id',
      name: 'preview',
      component: () => import('../views/preview/index.vue'),
      meta: { title: '预览' }
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('../views/reports/list.vue'),
      meta: { title: '在线报告' }
    },
    {
      path: '/reports/:id/edit',
      name: 'report-edit',
      component: () => import('../views/reports/edit.vue'),
      meta: { title: '编辑报告' }
    }
  ]
})
