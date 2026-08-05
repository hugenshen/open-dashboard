declare module '*.js' {
  export function mountHiFiDashboard(options: {
    mode?: 'editor' | 'preview' | 'share'
    /** 预览页返回去向：editor → 编辑器；list → 列表 */
    previewFrom?: 'editor' | 'list'
    dash: unknown
    datasets?: Record<string, unknown>
    preferredDatasetId?: string | null
    /** 映射 hi-fi 默认 id → 产品挂载点，避免冲突 Vue 根 #app */
    rootIds?: Partial<Record<'app' | 'ctx' | 'mask' | 'toasts', string>>
    onDirty?: (dash: unknown) => void
    onBack?: () => void
    onPreview?: (dash: unknown) => void
    onPublish?: (dash: unknown) => void | Promise<void>
    onShare?: (opts: { visibility: string; perm: string }) => Promise<unknown> | unknown
    onExportChart?: (chartId: string, chart?: unknown) => Promise<void> | void
  }): {
    getDash: () => unknown
    setDash: (d: unknown) => void
    rerender: () => void
    destroy: () => void
  }
}
