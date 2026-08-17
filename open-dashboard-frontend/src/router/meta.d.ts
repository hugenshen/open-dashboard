export {}

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    fullBleed?: boolean
    hideShell?: boolean
    shell?: 'default' | 'editor'
  }
}
