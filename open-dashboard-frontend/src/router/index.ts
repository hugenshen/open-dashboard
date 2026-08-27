import { createRouter, createWebHistory } from 'vue-router'
import { authApi, type AuthMe } from '../api/auth'
import { clearAuthHeaders, hasAuthSession, setAuthFromMe } from '../api/http'

let authCache: AuthMe | null = null

function hasPermission(me: AuthMe, permission: string) {
  const permissions = me.effectivePermissions?.length ? me.effectivePermissions : me.permissions || []
  if (permissions.includes('*') || permissions.includes(permission)) return true
  const colon = permission.indexOf(':')
  return colon > 0 && permissions.includes(permission.slice(0, colon + 1) + '*')
}

async function currentAuth(): Promise<AuthMe | null> {
  if (authCache) return authCache
  try {
    authCache = await authApi.me()
    setAuthFromMe(authCache)
    return authCache
  } catch {
    clearAuthHeaders()
    authCache = null
    return null
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/workbench' },
    { path: '/list', redirect: '/dashboards' },
    { path: '/editor/:id', redirect: (to) => `/dashboards/${to.params.id}/edit` },
    { path: '/preview/:id', redirect: (to) => `/dashboards/${to.params.id}/preview` },

    {
      path: '/login',
      name: 'login',
      component: () => import('../auth/views/Login.vue'),
      meta: { title: '登录', hideShell: true, public: true }
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('../auth/views/Register.vue'),
      meta: { title: '注册', hideShell: true, public: true }
    },
    {
      path: '/forbidden',
      name: 'forbidden',
      component: () => import('../auth/views/Forbidden.vue'),
      meta: { title: '无权限', hideShell: true, public: true }
    },
    {
      path: '/workbench',
      name: 'workbench',
      component: () => import('../workbench/views/Workbench.vue'),
      meta: { title: '工作台', fullBleed: true }
    },
    {
      path: '/datasources',
      name: 'datasources',
      component: () => import('../datasource/views/DatasourceManage.vue'),
      meta: { title: '数据源', fullBleed: true, surface: 'manage' }
    },
    {
      path: '/datasources/:id',
      name: 'datasource-detail',
      component: () => import('../datasource/views/DatasourceManage.vue'),
      meta: { title: '数据源', fullBleed: true, surface: 'manage' }
    },
    {
      path: '/datasets',
      name: 'datasets',
      component: () => import('../dataset/views/DatasetManage.vue'),
      meta: { title: '数据集', fullBleed: true, surface: 'manage' }
    },
    {
      path: '/data-plaza',
      name: 'data-plaza',
      component: () => import('../data-plaza/views/DataPlaza.vue'),
      meta: { title: '数据广场', fullBleed: true }
    },
    {
      path: '/datasets/:id',
      name: 'dataset-detail',
      component: () => import('../dataset/views/DatasetManage.vue'),
      meta: { title: '数据集', fullBleed: true, surface: 'manage' }
    },
    {
      path: '/dashboards',
      name: 'dashboards',
      component: () => import('../dashboard/views/DashboardList.vue'),
      meta: { title: '仪表盘', fullBleed: true }
    },
    {
      path: '/dashboards/templates',
      name: 'dashboard-templates',
      component: () => import('../dashboard/views/TemplateMarket.vue'),
      meta: { title: '模板市场', fullBleed: true }
    },
    {
      path: '/dashboards/:id',
      name: 'dashboard-detail',
      component: () => import('../dashboard/views/DashboardList.vue'),
      meta: { title: '仪表盘', fullBleed: true }
    },
    {
      path: '/dashboards/:id/edit',
      name: 'dashboard-edit',
      component: () => import('../dashboard/views/DashboardEditor.vue'),
      meta: { title: '编辑仪表盘', fullBleed: true, shell: 'editor' }
    },
    {
      path: '/dashboards/:id/preview',
      name: 'dashboard-preview',
      component: () => import('../dashboard/views/DashboardPreview.vue'),
      meta: { title: '预览仪表盘', fullBleed: true }
    },
    {
      path: '/share/:token',
      name: 'dashboard-share',
      component: () => import('../dashboard/views/DashboardShareView.vue'),
      meta: { title: '分享仪表盘', fullBleed: true, hideShell: true, public: true }
    },
    {
      path: '/conversations/replay',
      name: 'conversations-replay',
      component: () => import('../conversation/views/UxJourneyReplay.vue'),
      meta: { title: '旅程回放', fullBleed: true }
    },
    {
      path: '/conversations/:id?',
      name: 'conversations',
      component: () => import('../conversation/views/ConversationDshSurface.vue'),
      meta: { title: '对话分析', fullBleed: true }
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('../views/reports/list.vue'),
      meta: { title: '在线报告', fullBleed: true }
    },
    {
      path: '/reports/:id',
      name: 'report-detail',
      component: () => import('../views/reports/list.vue'),
      meta: { title: '在线报告', fullBleed: true }
    },
    {
      path: '/reports/:id/edit',
      name: 'report-edit',
      component: () => import('../views/reports/edit.vue'),
      meta: { title: '编辑报告', fullBleed: true }
    },
    {
      path: '/reports/:id/preview',
      name: 'report-preview',
      component: () => import('../views/reports/preview.vue'),
      meta: { title: '预览报告', fullBleed: true }
    },
    {
      path: '/dimensions',
      redirect: '/knowledge'
    },
    {
      path: '/knowledge',
      name: 'knowledge',
      component: () => import('../dimension/views/DimensionManage.vue'),
      meta: { title: '知识库', fullBleed: true, surface: 'manage' }
    },
    {
      path: '/workspace-admin',
      name: 'workspace-admin',
      component: () => import('../workspace/views/WorkspaceAdmin.vue'),
      meta: {
        title: '成员权限',
        fullBleed: true,
        surface: 'manage',
        requiredPermissions: ['workspace:admin', 'workspace:manage_member', 'platform:admin']
      }
    }
  ]
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  if (!hasAuthSession()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  const me = await currentAuth()
  if (!me) {
    return { path: '/login', query: { redirect: to.fullPath, expired: '1' } }
  }
  const required = to.meta.requiredPermissions || []
  if (required.length && !required.some((permission) => hasPermission(me, permission))) {
    return { path: '/forbidden' }
  }
  return true
})
