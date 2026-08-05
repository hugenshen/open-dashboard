/**
 * Auth / menu shell APIs (identity from headers; no login page).
 */

import { apiFetch } from './http'

export type AuthMe = {
  userId: string
  displayName: string
  permissions: string[]
}

export type MenuItem = {
  key: string
  label: string
  path: string
}

export const authApi = {
  me: () => apiFetch<AuthMe>('/auth/me'),
  menus: () => apiFetch<MenuItem[]>('/auth/menus')
}
