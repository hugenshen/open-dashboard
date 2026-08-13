import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/workbench' },
    { path: '/list', redirect: '/dashboards' },
    { path: '/editor/:id', redirect: (to) => `/dashboards/${to.params.id}/edit` },
    { path: '/preview/:id', redirect: (to) => `/dashboards/${to.params.id}/preview` },

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
      meta: { title: '数据源', fullBleed: true }
    },
    {
      path: '/datasources/:id',
      name: 'datasource-detail',
      component: () => import('../datasource/views/DatasourceManage.vue'),
      meta: { title: '数据源', fullBleed: true }
    },
    {
      path: '/datasets',
      name: 'datasets',
      component: () => import('../dataset/views/DatasetManage.vue'),
      meta: { title: '数据集', fullBleed: true }
    },
    {
      path: '/datasets/:id',
      name: 'dataset-detail',
      component: () => import('../dataset/views/DatasetManage.vue'),
      meta: { title: '数据集', fullBleed: true }
    },
    {
      path: '/dashboards',
      name: 'dashboards',
      component: () => import('../dashboard/views/DashboardList.vue'),
      meta: { title: '仪表盘', fullBleed: true }
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
      meta: { title: '编辑仪表盘', fullBleed: true }
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
      meta: { title: '分享仪表盘', fullBleed: true, hideShell: true }
    },
    {
      path: '/conversations',
      name: 'conversations',
      component: () => import('../conversation/views/ConversationWorkspace.vue'),
      meta: { title: '对话分析', fullBleed: true }
    },
    {
      path: '/conversations/:id',
      name: 'conversation-detail',
      component: () => import('../conversation/views/ConversationWorkspace.vue'),
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
    }
  ]
})
