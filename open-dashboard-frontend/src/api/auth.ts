/**
 * Auth / menu shell APIs (identity from headers; no login page).
 */

import { apiFetch } from './http'

export type AuthMe = {
  userId: string
  displayName: string
  permissions: string[]
  workspaceId: string
  currentWorkspace?: WorkspaceVO
  workspaces?: WorkspaceVO[]
  groups?: WorkspaceGroupVO[]
  roles?: WorkspaceRoleVO[]
  effectivePermissions?: string[]
}

export type MenuItem = {
  key: string
  label: string
  path: string
  group?: 'use' | 'manage'
}

export type WorkspaceVO = {
  id: string
  name: string
  description: string
  mode: 'team' | 'shared' | 'personal'
  role: string
  current: boolean
  memberCount: number
  assetCount: number
}

export type WorkspaceGroupVO = {
  id: string
  name: string
  description: string
  memberCount: number
  roles: string[]
}

export type WorkspaceRoleVO = {
  code: string
  name: string
  description: string
  permissions: string[]
}

export const authApi = {
  me: () => apiFetch<AuthMe>('/auth/me'),
  menus: () => apiFetch<MenuItem[]>('/auth/menus')
}
