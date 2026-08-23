import { apiFetch } from '../api/http'
import type { WorkspaceGroupVO, WorkspaceRoleVO, WorkspaceVO } from '../api/auth'

export type WorkspaceMemberVO = {
  userId: string
  displayName: string
  status: 'active' | 'invited' | 'disabled'
  groups: string[]
  roles: string[]
}

export type WorkspaceSummaryVO = {
  workspace: WorkspaceVO
  groupCount: number
  memberCount: number
  roleCount: number
  assetCount: number
  myDataCount: number
  pendingRequestCount: number
  adminTasks: string[]
}

export type EffectivePermissionVO = {
  workspaceId: string
  userId: string
  permissions: string[]
  datasetScopes: string[]
}

export type DataAssetVO = {
  id: string
  name: string
  type: 'dataset' | 'dashboard' | 'combo' | 'file' | 'api'
  workspaceId: string
  workspaceName: string
  owner: string
  description: string
  source: string
  sensitiveLevel: 'low' | 'medium' | 'high'
  authStatus: 'granted' | 'requestable' | 'pending' | 'denied'
  added: boolean
  tags: string[]
  updatedAt: number
  actions: Array<'ask' | 'open' | 'add' | 'request' | 'manage'>
}

export type DataSpaceVO = {
  id: string
  name: string
  assetCount: number
  joined: boolean
}

export type DataRequestVO = {
  id: string
  assetId: string
  assetName: string
  workspaceId: string
  status: 'pending' | 'approved' | 'rejected'
  approver: string
  createdAt: number
  purpose: string
  requestedActions: string[]
}

export type DatasetMemberOption = {
  userId: string
  displayName: string
  username: string
  roles: string[]
}

export type DatasetGrantVO = {
  id: string
  datasetId: string
  subjectType: string
  subjectId: string
  subjectLabel: string
  action: string
}

export type DatasetPolicyVO = {
  id: string
  datasetId: string
  subjectType: string
  subjectId: string
  subjectLabel: string
  kind: 'row' | 'column' | string
  effect: string
  predicate: Record<string, unknown>
  enabled: boolean
}

export type DatasetPermissionBundle = {
  datasets: Array<{ id: string; name: string; tableName: string }>
  members: DatasetMemberOption[]
  grants: DatasetGrantVO[]
  policies: DatasetPolicyVO[]
}

export type DatasetGrantRequest = {
  datasetId: string
  subjectType?: 'user' | 'role' | 'group'
  subjectId: string
  action?: 'use' | 'manage' | 'owner'
  rowField?: string
  rowOp?: string
  rowValue?: string
  hideColumns?: string[]
}

export type DataPlazaVO = {
  currentWorkspace: WorkspaceVO
  spaces: DataSpaceVO[]
  assets: DataAssetVO[]
  myData: DataAssetVO[]
  requests: DataRequestVO[]
}

export const workspaceApi = {
  workspaces: () => apiFetch<WorkspaceVO[]>('/workspaces'),
  summary: (workspaceId: string) => apiFetch<WorkspaceSummaryVO>(`/workspaces/${workspaceId}/summary`),
  groups: (workspaceId: string) => apiFetch<WorkspaceGroupVO[]>(`/workspaces/${workspaceId}/groups`),
  members: (workspaceId: string) => apiFetch<WorkspaceMemberVO[]>(`/workspaces/${workspaceId}/members`),
  roles: (workspaceId: string) => apiFetch<WorkspaceRoleVO[]>(`/workspaces/${workspaceId}/roles`),
  effectivePermissions: (workspaceId: string) =>
    apiFetch<EffectivePermissionVO>(`/workspaces/${workspaceId}/effective-permissions`),
  dataPlaza: (workspaceId: string) => apiFetch<DataPlazaVO>(`/workspaces/${workspaceId}/data-plaza`),
  addToMyData: (workspaceId: string, assetId: string) =>
    apiFetch<DataAssetVO>(`/workspaces/${workspaceId}/data-plaza/${assetId}/add`, { method: 'POST' }),
  requestDataset: (
    workspaceId: string,
    data: { assetId: string; purpose: string; expireDays?: number; requestedActions?: string[] }
  ) => apiFetch<DataRequestVO>(`/workspaces/${workspaceId}/dataset-requests`, { method: 'POST', data }),
  datasetPermissions: (workspaceId: string) =>
    apiFetch<DatasetPermissionBundle>(`/workspaces/${workspaceId}/dataset-permissions`),
  grantDataset: (workspaceId: string, data: DatasetGrantRequest) =>
    apiFetch<DatasetGrantVO>(`/workspaces/${workspaceId}/dataset-permissions/grants`, { method: 'POST', data }),
  deleteGrant: (workspaceId: string, grantId: string) =>
    apiFetch<void>(`/workspaces/${workspaceId}/dataset-permissions/grants/${grantId}`, { method: 'DELETE' }),
  deletePolicy: (workspaceId: string, policyId: string) =>
    apiFetch<void>(`/workspaces/${workspaceId}/dataset-permissions/policies/${policyId}`, { method: 'DELETE' }),
  approveRequest: (workspaceId: string, requestId: string) =>
    apiFetch<DatasetGrantVO>(`/workspaces/${workspaceId}/dataset-requests/${requestId}/approve`, { method: 'POST' })
}
