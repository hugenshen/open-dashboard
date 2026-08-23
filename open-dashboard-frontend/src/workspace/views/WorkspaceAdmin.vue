<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getAuthBundle, setAuthFromMe } from '../../api/http'
import { authApi, type WorkspaceGroupVO, type WorkspaceRoleVO, type WorkspaceVO } from '../../api/auth'
import { datasetApi } from '../../dataset/api'
import {
  workspaceApi,
  type DatasetGrantVO,
  type DatasetMemberOption,
  type DatasetPermissionBundle,
  type DatasetPolicyVO,
  type EffectivePermissionVO,
  type WorkspaceMemberVO,
  type WorkspaceSummaryVO
} from '../api'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const tab = ref<'members' | 'groups' | 'roles' | 'policies'>('members')
const summary = ref<WorkspaceSummaryVO | null>(null)
const members = ref<WorkspaceMemberVO[]>([])
const groups = ref<WorkspaceGroupVO[]>([])
const roles = ref<WorkspaceRoleVO[]>([])
const effective = ref<EffectivePermissionVO | null>(null)
const permBundle = ref<DatasetPermissionBundle | null>(null)
const selectedDataset = ref('')
const grantSubject = ref('')
const grantAction = ref<'use' | 'manage'>('use')
const rowField = ref('')
const rowValue = ref('')
const hideColumns = ref('')
const savingGrant = ref(false)
const memberKeyword = ref('')

const workspaceId = computed(() => summary.value?.workspace.id || getAuthBundle().workspaceId)
const managedWorkspaces = ref<WorkspaceVO[]>([])
const showWorkspacePicker = computed(() => managedWorkspaces.value.length > 1)
const filteredMembers = computed(() => {
  const q = memberKeyword.value.trim().toLowerCase()
  if (!q) return members.value
  return members.value.filter((m) => `${m.userId} ${m.displayName} ${m.groups.join(' ')}`.toLowerCase().includes(q))
})

const statusCards = computed(() => [
  { label: '成员', value: summary.value?.memberCount || 0 },
  { label: '用户组', value: summary.value?.groupCount || 0 },
  { label: '角色', value: summary.value?.roleCount || 0 },
  { label: '资产', value: summary.value?.assetCount || 0 }
])

async function load() {
  loading.value = true
  error.value = ''
  const id = getAuthBundle().workspaceId
  try {
    const [sum, memberList, groupList, roleList, eff, ws, perms] = await Promise.all([
      workspaceApi.summary(id),
      workspaceApi.members(id),
      workspaceApi.groups(id),
      workspaceApi.roles(id),
      workspaceApi.effectivePermissions(id),
      workspaceApi.workspaces(),
      workspaceApi.datasetPermissions(id)
    ])
    summary.value = sum
    members.value = memberList
    groups.value = groupList
    roles.value = roleList
    effective.value = eff
    managedWorkspaces.value = ws
    permBundle.value = perms
    if (!perms.datasets.length) {
      const live = await datasetApi.list()
      permBundle.value = {
        ...perms,
        datasets: live.map((d) => ({ id: d.id, name: d.name, tableName: d.tableName || '' }))
      }
    }
    if (!permBundle.value.members.length && memberList.length) {
      permBundle.value = {
        ...permBundle.value,
        members: memberList.map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          username: m.userId,
          roles: m.roles
        }))
      }
    }
    if (!selectedDataset.value && permBundle.value.datasets.length) {
      selectedDataset.value = permBundle.value.datasets[0].id
    }
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

async function switchManagedWorkspace(ev: Event) {
  const id = (ev.target as HTMLSelectElement).value
  if (!id || id === workspaceId.value) return
  try {
    const me = await authApi.switchWorkspace(id)
    setAuthFromMe(me)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '切换工作区失败'
  }
}

function goPlaza() {
  void router.push('/data-plaza')
}

const grantMembers = computed<DatasetMemberOption[]>(() => {
  if (permBundle.value?.members?.length) return permBundle.value.members
  return members.value.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    username: m.userId,
    roles: m.roles
  }))
})
const datasetGrants = computed(() => {
  const id = selectedDataset.value
  return (permBundle.value?.grants || []).filter((g) => g.datasetId === id)
})
const datasetPolicies = computed(() => {
  const id = selectedDataset.value
  return (permBundle.value?.policies || []).filter((p) => p.datasetId === id)
})

function policySummary(policy: DatasetPolicyVO) {
  if (policy.kind === 'row') {
    const items = (policy.predicate as { items?: Array<{ field?: string; op?: string; value?: string }> }).items
    const first = items?.[0]
    if (first?.field) return `${first.field} ${first.op || '='} ${first.value ?? ''}`
    return '行过滤'
  }
  const hide = (policy.predicate as { hide?: string[]; columns?: string[] }).hide
    || (policy.predicate as { columns?: string[] }).columns
    || []
  return hide.length ? `隐藏 ${hide.join(', ')}` : '列策略'
}

async function submitGrant() {
  const id = workspaceId.value
  if (!id || !selectedDataset.value || !grantSubject.value) {
    error.value = '请选择数据集和成员'
    return
  }
  savingGrant.value = true
  error.value = ''
  try {
    const hide = hideColumns.value
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    await workspaceApi.grantDataset(id, {
      datasetId: selectedDataset.value,
      subjectType: 'user',
      subjectId: grantSubject.value,
      action: grantAction.value,
      rowField: rowField.value.trim() || undefined,
      rowOp: 'eq',
      rowValue: rowValue.value.trim() || undefined,
      hideColumns: hide.length ? hide : undefined
    })
    rowField.value = ''
    rowValue.value = ''
    hideColumns.value = ''
    permBundle.value = await workspaceApi.datasetPermissions(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '授权失败'
  } finally {
    savingGrant.value = false
  }
}

async function removeGrant(grant: DatasetGrantVO) {
  const id = workspaceId.value
  if (!id) return
  try {
    await workspaceApi.deleteGrant(id, grant.id)
    permBundle.value = await workspaceApi.datasetPermissions(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '撤销失败'
  }
}

async function removePolicy(policy: DatasetPolicyVO) {
  const id = workspaceId.value
  if (!id) return
  try {
    await workspaceApi.deletePolicy(id, policy.id)
    permBundle.value = await workspaceApi.datasetPermissions(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除策略失败'
  }
}

onMounted(load)
</script>

<template>
  <main class="admin-page">
    <section class="admin-head">
      <div>
        <h1>{{ summary?.workspace.name || '成员权限' }}</h1>
        <p>当前工作区成员、角色与数据权限。给成员开通整表，或再加行列策略。</p>
      </div>
      <div class="head-actions">
        <label v-if="showWorkspacePicker" class="ws-pick">
          <span>治理工作区</span>
          <select :value="workspaceId" @change="switchManagedWorkspace">
            <option v-for="ws in managedWorkspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
          </select>
        </label>
        <button type="button" @click="load" :disabled="loading">刷新</button>
      </div>
    </section>

    <section v-if="error" class="load-error">{{ error }}</section>

    <div class="stat-row">
      <div v-for="card in statusCards" :key="card.label">
        <strong>{{ card.value }}</strong>
        <span>{{ card.label }}</span>
      </div>
    </div>

    <section class="admin-main">
      <div class="admin-toolbar">
        <div class="tabs">
          <button type="button" :class="{ on: tab === 'members' }" @click="tab = 'members'">成员</button>
          <button type="button" :class="{ on: tab === 'groups' }" @click="tab = 'groups'">用户组</button>
          <button type="button" :class="{ on: tab === 'roles' }" @click="tab = 'roles'">角色</button>
          <button type="button" :class="{ on: tab === 'policies' }" @click="tab = 'policies'">数据权限</button>
        </div>
        <input v-if="tab === 'members'" v-model="memberKeyword" type="search" placeholder="搜索成员、账号或用户组" />
      </div>

      <div v-if="loading" class="empty">正在加载工作区治理信息...</div>

      <div v-else-if="tab === 'members'" class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>成员</th>
              <th>状态</th>
              <th>用户组</th>
              <th>角色</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in filteredMembers" :key="member.userId">
              <td>
                <b>{{ member.displayName }}</b>
                <small>{{ member.userId }}</small>
              </td>
              <td><i :class="member.status">{{ statusText(member.status) }}</i></td>
              <td>{{ member.groups.join(' / ') || '—' }}</td>
              <td>{{ member.roles.join(' / ') || '—' }}</td>
            </tr>
            <tr v-if="!filteredMembers.length">
              <td colspan="4" class="empty-cell">没有匹配的成员</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="tab === 'groups'" class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>用户组</th>
              <th>说明</th>
              <th>成员</th>
              <th>角色</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in groups" :key="group.id">
              <td><b>{{ group.name }}</b></td>
              <td class="muted">{{ group.description || '—' }}</td>
              <td>{{ group.memberCount }}</td>
              <td>{{ group.roles.join(' / ') || '—' }}</td>
            </tr>
            <tr v-if="!groups.length">
              <td colspan="4" class="empty-cell">还没有用户组</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="tab === 'roles'" class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>角色</th>
              <th>说明</th>
              <th>权限</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="role in roles" :key="role.code">
              <td><b>{{ role.name }}</b></td>
              <td class="muted">{{ role.description || '—' }}</td>
              <td>
                <span v-for="perm in role.permissions" :key="perm" class="chip">{{ perm }}</span>
              </td>
            </tr>
            <tr v-if="!roles.length">
              <td colspan="3" class="empty-cell">还没有角色</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="policy-box">
        <div class="policy-toolbar">
          <label>
            数据集
            <select v-model="selectedDataset">
              <option v-for="ds in permBundle?.datasets || []" :key="ds.id" :value="ds.id">
                {{ ds.name }} ({{ ds.id }})
              </option>
            </select>
          </label>
          <button type="button" class="ghost" @click="goPlaza">打开数据广场</button>
        </div>
        <p class="hint">
          角色「分析师」默认已有整表 use。给某个用户加行过滤或隐藏列后，该用户查询会走 Java QueryGuard，不会改问数 SQL。
          <span v-if="effective?.permissions?.length">当前账号：{{ effective.permissions.join(' · ') }}</span>
        </p>
        <form class="grant-form" @submit.prevent="submitGrant">
          <label>
            成员
            <select v-model="grantSubject">
              <option value="">选择成员</option>
              <option v-for="m in grantMembers" :key="m.userId" :value="m.userId">
                {{ m.displayName }} ({{ m.userId }})
              </option>
            </select>
          </label>
          <label>
            动作
            <select v-model="grantAction">
              <option value="use">use 可问/出数</option>
              <option value="manage">manage 管理</option>
            </select>
          </label>
          <label>
            行字段
            <input v-model="rowField" placeholder="如 region，空=整表" />
          </label>
          <label>
            行等于
            <input v-model="rowValue" placeholder="如 华东" />
          </label>
          <label>
            隐藏列
            <input v-model="hideColumns" placeholder="phone, cost" />
          </label>
          <button type="submit" class="primary" :disabled="savingGrant">开通</button>
        </form>
        <table class="admin-table">
          <thead>
            <tr>
              <th>主体</th>
              <th>动作</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="grant in datasetGrants" :key="grant.id">
              <td>
                <b>{{ grant.subjectLabel }}</b>
                <small>{{ grant.subjectType }} / {{ grant.subjectId }}</small>
              </td>
              <td>{{ grant.action }}</td>
              <td><button type="button" @click="removeGrant(grant)">撤销</button></td>
            </tr>
            <tr v-if="!datasetGrants.length">
              <td colspan="3" class="empty-cell">该数据集还没有额外授权</td>
            </tr>
          </tbody>
        </table>
        <h3>行列策略</h3>
        <table class="admin-table">
          <thead>
            <tr>
              <th>主体</th>
              <th>类型</th>
              <th>规则</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="policy in datasetPolicies" :key="policy.id">
              <td>
                <b>{{ policy.subjectLabel }}</b>
                <small>{{ policy.subjectType }} / {{ policy.subjectId }}</small>
              </td>
              <td>{{ policy.kind === 'row' ? '行过滤' : '列隐藏' }}</td>
              <td class="muted">{{ policySummary(policy) }}</td>
              <td><button type="button" @click="removePolicy(policy)">删除</button></td>
            </tr>
            <tr v-if="!datasetPolicies.length">
              <td colspan="4" class="empty-cell">无用户级行列策略（整表）</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
.admin-page {
  min-height: 100%;
  padding: 20px 24px 40px;
  overflow: auto;
  background: #f6f7fb;
  color: #111827;
}
.admin-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}
.admin-head h1 {
  margin: 0 0 6px;
  font-size: 20px;
}
.admin-head p {
  margin: 0;
  color: #4b5563;
  font-size: 13px;
}
.head-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.ws-pick {
  display: grid;
  gap: 4px;
  min-width: 200px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 650;
}
.ws-pick select {
  height: 34px;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  padding: 0 10px;
  font: inherit;
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
.primary {
  background: #4f46e5;
  border-color: #4f46e5;
  color: #fff;
}
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.stat-row div {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 10px;
  padding: 12px 14px;
}
.stat-row strong {
  display: block;
  font-size: 22px;
  line-height: 1.1;
}
.stat-row span {
  color: #4b5563;
  font-size: 12px;
}
.admin-main {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 10px;
  min-width: 0;
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
.table-wrap {
  overflow: auto;
  padding: 8px 12px 16px;
}
.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.admin-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 11px;
  color: #6b7280;
  font-weight: 700;
  border-bottom: 1px solid #eef0f4;
}
.admin-table td {
  padding: 12px;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
}
.admin-table td b,
.admin-table td small {
  display: block;
}
.admin-table td small,
.admin-table td.muted {
  color: #6b7280;
  font-size: 12px;
}
.admin-table i {
  display: inline-flex;
  border-radius: 7px;
  padding: 3px 8px;
  font-style: normal;
  background: #f3f4f6;
}
.admin-table i.active {
  color: #047857;
  background: #ecfdf5;
}
.admin-table i.invited {
  color: #92400e;
  background: #fffbeb;
}
.empty-cell {
  text-align: center;
  color: #6b7280;
  padding: 36px 12px !important;
}
.chip {
  display: inline-flex;
  margin: 0 6px 6px 0;
  border: 1px solid #d8dde7;
  border-radius: 7px;
  padding: 3px 8px;
  background: #f7f8fc;
  color: #4b5563;
  font-size: 12px;
  font-weight: 650;
}
.policy-box {
  padding: 20px 18px 24px;
  color: #4b5563;
  line-height: 1.65;
}
.policy-box h3 {
  margin: 18px 0 8px;
  color: #111827;
  font-size: 14px;
}
.policy-toolbar {
  display: flex;
  gap: 12px;
  align-items: end;
  justify-content: space-between;
  margin-bottom: 10px;
}
.policy-toolbar label,
.grant-form label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  font-weight: 650;
  color: #6b7280;
}
.policy-toolbar select,
.grant-form select,
.grant-form input {
  height: 34px;
  min-width: 180px;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  padding: 0 10px;
  font: inherit;
}
.grant-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;
  margin: 12px 0 16px;
}
.hint {
  margin: 0 0 8px;
  font-size: 13px;
}
.ghost {
  background: #fff;
}
.load-error,
.empty {
  margin: 14px;
  border: 1px dashed #cfd5df;
  border-radius: 10px;
  background: #fafbff;
  color: #6b7280;
  padding: 16px;
  min-height: 160px;
  display: grid;
  place-items: center;
}
.load-error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #b42318;
  min-height: 0;
  margin: 0 0 14px;
}
@media (max-width: 900px) {
  .stat-row {
    grid-template-columns: 1fr 1fr;
  }
  .admin-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .admin-toolbar input {
    width: 100%;
  }
}
</style>
