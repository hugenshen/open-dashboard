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
  ) => apiFetch<DataRequestVO>(`/workspaces/${workspaceId}/dataset-requests`, { method: 'POST', data })
}
