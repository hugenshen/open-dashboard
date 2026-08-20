<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getAuthBundle } from '../../api/http'
import type { WorkspaceGroupVO, WorkspaceRoleVO } from '../../api/auth'
import {
  workspaceApi,
  type EffectivePermissionVO,
  type WorkspaceMemberVO,
  type WorkspaceSummaryVO
} from '../api'

const loading = ref(false)
const error = ref('')
const tab = ref<'members' | 'groups' | 'roles' | 'policies'>('members')
const summary = ref<WorkspaceSummaryVO | null>(null)
const members = ref<WorkspaceMemberVO[]>([])
const groups = ref<WorkspaceGroupVO[]>([])
const roles = ref<WorkspaceRoleVO[]>([])
const effective = ref<EffectivePermissionVO | null>(null)
const memberKeyword = ref('')

const workspaceId = computed(() => summary.value?.workspace.id || getAuthBundle().workspaceId)
const filteredMembers = computed(() => {
  const q = memberKeyword.value.trim().toLowerCase()
  if (!q) return members.value
  return members.value.filter((m) => `${m.userId} ${m.displayName} ${m.groups.join(' ')}`.toLowerCase().includes(q))
})

const statusCards = computed(() => [
  { label: '成员', value: summary.value?.memberCount || 0 },
  { label: '用户组', value: summary.value?.groupCount || 0 },
  { label: '角色', value: summary.value?.roleCount || 0 },
  { label: '资产', value: summary.value?.assetCount || 0 },
  { label: '我的数据', value: summary.value?.myDataCount || 0 },
  { label: '待处理申请', value: summary.value?.pendingRequestCount || 0 }
])

async function load() {
  loading.value = true
  error.value = ''
  const id = getAuthBundle().workspaceId
  try {
    const [sum, memberList, groupList, roleList, eff] = await Promise.all([
      workspaceApi.summary(id),
      workspaceApi.members(id),
      workspaceApi.groups(id),
      workspaceApi.roles(id),
      workspaceApi.effectivePermissions(id)
    ])
    summary.value = sum
    members.value = memberList
    groups.value = groupList
    roles.value = roleList
    effective.value = eff
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工作区治理数据加载失败'
  } finally {
    loading.value = false
  }
}

function statusText(status: WorkspaceMemberVO['status']) {
  if (status === 'active') return '已启用'
  if (status === 'invited') return '待加入'
  return '已停用'
}

onMounted(load)
</script>

<template>
  <main class="admin-page">
    <section class="admin-head">
      <div>
        <p>管理端 · 工作区隔离与权限治理</p>
        <h1>{{ summary?.workspace.name || '成员权限' }}</h1>
        <span>{{ summary?.workspace.description || '管理项目组成员、用户组、角色权限、数据资产消费边界。' }}</span>
      </div>
      <div class="head-actions">
        <button type="button" @click="load" :disabled="loading">刷新</button>
        <button class="primary" type="button">邀请成员</button>
      </div>
    </section>

    <section v-if="error" class="load-error">{{ error }}</section>

    <section class="admin-layout">
      <aside class="admin-left">
        <div class="stat-grid">
          <div v-for="card in statusCards" :key="card.label">
            <strong>{{ card.value }}</strong>
            <span>{{ card.label }}</span>
          </div>
        </div>
        <div class="panel">
          <h2>治理待办</h2>
          <ul>
            <li v-for="task in summary?.adminTasks || []" :key="task">{{ task }}</li>
          </ul>
        </div>
        <div class="panel">
          <h2>当前权限</h2>
          <div class="scope-list">
            <span v-for="perm in effective?.permissions || []" :key="perm">{{ perm }}</span>
          </div>
        </div>
      </aside>

      <section class="admin-main">
        <div class="admin-toolbar">
          <div class="tabs">
            <button type="button" :class="{ on: tab === 'members' }" @click="tab = 'members'">成员</button>
            <button type="button" :class="{ on: tab === 'groups' }" @click="tab = 'groups'">用户组</button>
            <button type="button" :class="{ on: tab === 'roles' }" @click="tab = 'roles'">角色权限</button>
            <button type="button" :class="{ on: tab === 'policies' }" @click="tab = 'policies'">数据策略</button>
          </div>
          <input v-if="tab === 'members'" v-model="memberKeyword" type="search" placeholder="搜索成员、账号或用户组" />
        </div>

        <div v-if="loading" class="empty">正在加载工作区治理信息...</div>

        <div v-else-if="tab === 'members'" class="member-table">
          <div class="table-head">
            <span>成员</span><span>状态</span><span>用户组</span><span>角色</span><span>操作</span>
          </div>
          <div v-for="member in filteredMembers" :key="member.userId" class="table-row">
            <span><b>{{ member.displayName }}</b><small>{{ member.userId }}</small></span>
            <span><i :class="member.status">{{ statusText(member.status) }}</i></span>
            <span>{{ member.groups.join(' / ') }}</span>
            <span>{{ member.roles.join(' / ') }}</span>
            <span><button type="button">调整</button></span>
          </div>
        </div>

        <div v-else-if="tab === 'groups'" class="card-grid">
          <article v-for="group in groups" :key="group.id">
            <h2>{{ group.name }}</h2>
            <p>{{ group.description }}</p>
            <div class="card-meta">
              <span>{{ group.memberCount }} 个成员</span>
              <span>{{ group.roles.join(' / ') }}</span>
            </div>
            <button type="button">维护成员</button>
          </article>
        </div>

        <div v-else-if="tab === 'roles'" class="card-grid">
          <article v-for="role in roles" :key="role.code">
            <h2>{{ role.name }}</h2>
            <p>{{ role.description }}</p>
            <div class="scope-list">
              <span v-for="perm in role.permissions" :key="perm">{{ perm }}</span>
            </div>
            <button type="button">查看授权</button>
          </article>
        </div>

        <div v-else class="policy-grid">
          <article>
            <h2>资产发布范围</h2>
            <p>数据集发布到指定工作区和用户组，用户端数据广场只展示业务说明、负责人、敏感等级和申请条件。</p>
            <button type="button">发布资产</button>
          </article>
          <article>
            <h2>行列权限</h2>
            <p>高敏字段默认隐藏，按用户组授予脱敏或明细权限；问数和看板查询复用同一策略。</p>
            <button type="button">配置策略</button>
          </article>
          <article>
            <h2>审批流</h2>
            <p>消费申请记录用途、有效期、动作范围和审批人，审批通过后进入我的数据与 askable 集合。</p>
            <button type="button">处理申请</button>
          </article>
          <article>
            <h2>审计</h2>
            <p>成员变更、资产发布、审批、问数消费和导出动作按工作区留痕。</p>
            <button type="button">查看审计</button>
          </article>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.admin-page {
  min-height: 100%;
  padding: 24px 28px 40px;
  overflow: auto;
  background: #f6f7fb;
  color: #111827;
}

.admin-head {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 10px;
  padding: 22px 24px;
  display: flex;
  justify-content: space-between;
  gap: 20px;
}

.admin-head p {
  margin: 0 0 8px;
  color: #4f46e5;
  font-size: 13px;
  font-weight: 700;
}

.admin-head h1 {
  margin: 0 0 10px;
  font-size: 28px;
}

.admin-head span,
.panel li,
.card-grid p,
.policy-grid p {
  color: #4b5563;
  line-height: 1.65;
}

.head-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

button {
  min-height: 34px;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #fff;
  padding: 0 13px;
  color: #111827;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.primary,
button:hover {
  border-color: #4f46e5;
  color: #4338ca;
}

.primary {
  background: #4f46e5;
  color: #fff;
}

.admin-layout {
  display: grid;
  grid-template-columns: 330px minmax(720px, 1fr);
  gap: 16px;
  margin-top: 16px;
}

.admin-left,
.admin-main {
  min-width: 0;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.stat-grid div,
.panel,
.admin-main,
.card-grid article,
.policy-grid article {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 10px;
}

.stat-grid div {
  padding: 14px;
}

.stat-grid strong {
  display: block;
  font-size: 24px;
  line-height: 1.1;
}

.stat-grid span {
  color: #4b5563;
  font-size: 13px;
}

.panel {
  margin-top: 12px;
  padding: 16px;
}

h2 {
  margin: 0 0 10px;
  font-size: 16px;
}

.panel ul {
  margin: 0;
  padding-left: 18px;
}

.admin-toolbar {
  min-height: 58px;
  padding: 12px 14px;
  border-bottom: 1px solid #dfe3ea;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tabs button.on {
  background: #eef2ff;
  border-color: #c7d2fe;
  color: #3730a3;
}

.admin-toolbar input {
  width: min(320px, 36vw);
  height: 36px;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #f7f8fc;
  padding: 0 12px;
  font: inherit;
}

.member-table {
  padding: 14px;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: 1.2fr 0.7fr 1.2fr 1.2fr 90px;
  gap: 10px;
  align-items: center;
}

.table-head {
  min-height: 36px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
}

.table-row {
  min-height: 64px;
  border-top: 1px solid #e5e7eb;
  color: #374151;
}

.table-row b,
.table-row small {
  display: block;
}

.table-row small {
  color: #6b7280;
}

.table-row i {
  display: inline-flex;
  border-radius: 7px;
  padding: 3px 8px;
  font-style: normal;
  background: #f3f4f6;
}

.table-row i.active {
  color: #047857;
  background: #ecfdf5;
}

.table-row i.invited {
  color: #92400e;
  background: #fffbeb;
}

.card-grid,
.policy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}

.card-grid article,
.policy-grid article {
  padding: 16px;
}

.card-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0;
}

.card-meta span,
.scope-list span {
  border: 1px solid #d8dde7;
  border-radius: 7px;
  padding: 4px 8px;
  background: #f7f8fc;
  color: #4b5563;
  font-size: 12px;
  font-weight: 650;
}

.scope-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.load-error,
.empty {
  margin-top: 16px;
  border: 1px dashed #fecaca;
  border-radius: 10px;
  background: #fef2f2;
  color: #b42318;
  padding: 16px;
}

.empty {
  margin: 14px;
  min-height: 240px;
  display: grid;
  place-items: center;
  border-color: #cfd5df;
  background: #fafbff;
  color: #6b7280;
}

@media (max-width: 1060px) {
  .admin-layout,
  .card-grid,
  .policy-grid {
    grid-template-columns: 1fr;
  }

  .admin-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .admin-toolbar input {
    width: 100%;
  }
}
</style>
