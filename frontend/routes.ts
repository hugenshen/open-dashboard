/**
 * Suggested routes for target product router.
 */
export const dashboardRoutes = [
  {
    path: '/dashboard',
    name: 'DashboardList',
    component: () => import('../views/list/index.vue'),
    meta: { title: '仪表盘' }
  },
  {
    path: '/dashboard/editor',
    name: 'DashboardEditor',
    component: () => import('../views/editor/index.vue'),
    meta: { title: '编辑仪表盘' }
  },
  {
    path: '/dashboard/preview',
    name: 'DashboardPreview',
    component: () => import('../views/preview/index.vue'),
    meta: { title: '预览仪表盘' }
  }
]
