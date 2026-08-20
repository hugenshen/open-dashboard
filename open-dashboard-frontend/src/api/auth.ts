/**
 * Auth / menu shell APIs. Backend resolves identity from HttpOnly session cookie.
 */

import { apiFetch, clearAuthHeaders, setAuthFromMe } from './http'

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

export type LoginRequest = {
  username: string
  password: string
  workspaceId?: string
}

export type RegisterRequest = {
  username: string
  password: string
  displayName?: string
  email?: string
  workspaceId?: string
}

export type ChangePasswordRequest = {
  oldPassword: string
  newPassword: string
}

export const authApi = {
  login: async (data: LoginRequest) => {
    const me = await apiFetch<AuthMe>('/auth/login', { method: 'POST', data })
    setAuthFromMe(me)
    return me
  },
  register: async (data: RegisterRequest) => {
    const me = await apiFetch<AuthMe>('/auth/register', { method: 'POST', data })
    setAuthFromMe(me)
    return me
  },
  logout: async () => {
    try {
      await apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' })
    } finally {
      clearAuthHeaders()
    }
  },
  switchWorkspace: async (workspaceId: string) => {
    const me = await apiFetch<AuthMe>('/auth/workspace', { method: 'POST', data: { workspaceId } })
    setAuthFromMe(me)
    return me
  },
  changePassword: (data: ChangePasswordRequest) =>
    apiFetch<{ ok: boolean }>('/auth/password', { method: 'POST', data }),
  me: () => apiFetch<AuthMe>('/auth/me'),
  menus: () => apiFetch<MenuItem[]>('/auth/menus')
}
