export {}

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    fullBleed?: boolean
    hideShell?: boolean
    public?: boolean
    requiredPermissions?: string[]
    surface?: 'use' | 'manage'
  }
}
