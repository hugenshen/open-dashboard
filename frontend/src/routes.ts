/**
 * Route table (also wired in router/index.ts).
 * Kept for docs / agents that previously imported dashboardRoutes.
 */
export const dashboardRoutes = [
  { path: '/list', name: 'list', meta: { title: '仪表盘列表' } },
  { path: '/editor/:id', name: 'editor', meta: { title: '编辑器' } },
  { path: '/preview/:id', name: 'preview', meta: { title: '预览' } }
]
