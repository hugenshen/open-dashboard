<script setup lang="ts">
/**
 * Dashboard list — tree + barInfo, aligned with dataset list IA.
 * Target path suggestion: views/visualized/view/dashboard/index.vue
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDashboardMetaStore } from '../../stores/dashboardStores'

const router = useRouter()
const metaStore = useDashboardMetaStore()
const creating = ref(false)
const newName = ref('未命名仪表盘')

onMounted(() => {
  metaStore.loadTree()
})

async function onSelect(id: string, nodeType: string) {
  await metaStore.selectNode(id)
  if (nodeType === 'dashboard') {
    // stay on list; enter editor via explicit action
  }
}

async function createDashboard() {
  creating.value = true
  try {
    const node = await metaStore.createDashboard('0', newName.value)
    await metaStore.selectNode(node.id)
  } finally {
    creating.value = false
  }
}

function openEditor() {
  if (!metaStore.currentId) return
  router.push({ path: '/dashboard/editor', query: { id: metaStore.currentId } })
}

function openPreview() {
  if (!metaStore.currentId) return
  router.push({ path: '/dashboard/preview', query: { id: metaStore.currentId } })
}
</script>

<template>
  <div class="dashboard-list">
    <aside class="tree-pane">
      <header class="pane-header">
        <h1>仪表盘</h1>
        <button :disabled="creating" @click="createDashboard">新建</button>
      </header>
      <ul class="tree">
        <li
          v-for="node in metaStore.tree"
          :key="node.id"
          :class="{ active: metaStore.currentId === node.id }"
          @click="onSelect(node.id, node.nodeType)"
        >
          <span class="type">{{ node.nodeType === 'folder' ? '📁' : '📊' }}</span>
          {{ node.name }}
          <ul v-if="node.children?.length">
            <li
              v-for="child in node.children"
              :key="child.id"
              :class="{ active: metaStore.currentId === child.id }"
              @click.stop="onSelect(child.id, child.nodeType)"
            >
              {{ child.name }}
            </li>
          </ul>
        </li>
      </ul>
    </aside>
    <section class="detail-pane" v-if="metaStore.barInfo">
      <h2>{{ metaStore.barInfo.name }}</h2>
      <dl>
        <dt>类型</dt>
        <dd>{{ metaStore.barInfo.nodeType }}</dd>
        <dt>状态</dt>
        <dd>{{ metaStore.barInfo.status }}</dd>
        <dt>图表数</dt>
        <dd>{{ metaStore.barInfo.chartCount }}</dd>
      </dl>
      <div class="actions" v-if="metaStore.barInfo.nodeType === 'dashboard'">
        <button @click="openEditor">编辑</button>
        <button @click="openPreview">预览已发布</button>
      </div>
    </section>
    <section class="detail-pane empty" v-else>
      <p>选择左侧节点查看详情</p>
    </section>
  </div>
</template>

<style scoped>
.dashboard-list {
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 100vh;
}
.tree-pane {
  border-right: 1px solid #e5e5e5;
  padding: 16px;
}
.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.tree {
  list-style: none;
  padding: 0;
  margin: 0;
}
.tree li {
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
}
.tree li.active {
  background: #f0f4ff;
}
.detail-pane {
  padding: 24px;
}
.detail-pane.empty {
  color: #888;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>
