import { apiFetch, apiFetchForm } from '../api/http'

export interface DatasourceVO {
  id: string
  name: string
  type: string
  host?: string
  port?: number | null
  dbName?: string
  schema?: string | null
  username?: string
  hasPassword?: boolean
  status: string
  ext?: Record<string, unknown>
  updateTime?: number
}

export interface TableItem {
  name: string
  comment?: string
}

export interface ColumnItem {
  name: string
  dataType: string
  originType?: string
  comment?: string
}

export interface DatasetFieldVO {
  name: string
  label: string
  group: string
  dataType?: string
  origin?: 'table' | 'calc'
  expression?: string
}

export interface DatasetMetaVO {
  id: string
  name: string
  folder?: string
  datasourceId?: string
  tableName?: string
  status: string
  updateTime?: number
}

export interface DatasetDetailVO {
  meta: DatasetMetaVO
  fields: DatasetFieldVO[]
}

export interface ProbeRequest {
  type: string
  host?: string
  port?: number | null
  dbName?: string
  schema?: string
  username?: string
  password?: string
  action: 'ping' | 'databases' | 'schemas' | 'tables' | 'columns'
  table?: string
}

async function http<T>(method: string, url: string, data?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    data
  })
}

export const datasourceApi = {
  list: () => http<DatasourceVO[]>('GET', '/datasource'),
  get: (id: string) => http<DatasourceVO>('GET', `/datasource/${id}`),
  create: (data: {
    name: string
    type: string
    host?: string
    port?: number
    dbName?: string
    schema?: string
    username?: string
    password?: string
    ext?: Record<string, unknown>
  }) => http<DatasourceVO>('POST', '/datasource', data),
  update: (
    id: string,
    data: Partial<{
      name: string
      host: string
      port: number
      dbName: string
      schema: string
      username: string
      password: string
      status: string
      ext: Record<string, unknown>
    }>
  ) => http<DatasourceVO>('PATCH', `/datasource/${id}`, data),
  remove: (id: string) => http<void>('DELETE', `/datasource/${id}`),
  ping: (id: string) =>
    http<{ ok: boolean; message: string; latencyMs?: number }>('POST', `/datasource/${id}/ping`),
  probe: (data: ProbeRequest) =>
    http<{
      ok: boolean
      message?: string
      latencyMs?: number
      databases?: string[]
      schemas?: string[]
      tables?: TableItem[]
      columns?: ColumnItem[]
    }>('POST', '/datasource/probe', data),
  databases: (id: string) => http<string[]>('GET', `/datasource/${id}/databases`),
  schemas: (id: string) => http<string[]>('GET', `/datasource/${id}/schemas`),
  tables: (id: string, schema?: string) =>
    http<TableItem[]>(
      'GET',
      `/datasource/${id}/tables${schema ? `?schema=${encodeURIComponent(schema)}` : ''}`
    ),
  columns: (id: string, table: string, schema?: string) =>
    http<ColumnItem[]>(
      'GET',
      `/datasource/${id}/tables/${encodeURIComponent(table)}/columns${
        schema ? `?schema=${encodeURIComponent(schema)}` : ''
      }`
    ),
  preview: (id: string, body: { table: string; schema?: string; limit?: number }) =>
    http<{
      columns: Array<{ name: string; dataType: string }>
      rows: unknown[][]
      sql?: string
    }>('POST', `/datasource/${id}/preview`, body)
}

export const datasetApi = {
  list: () => http<DatasetMetaVO[]>('GET', '/dataset'),
  listAskable: () => http<DatasetMetaVO[]>('GET', '/dataset/askable'),
  get: (id: string) => http<DatasetDetailVO>('GET', `/dataset/${id}`),
  create: (data: {
    name: string
    folder?: string
    datasourceId?: string
    tableName?: string
    fields?: DatasetFieldVO[]
  }) => http<DatasetDetailVO>('POST', '/dataset', data),
  update: (id: string, data: Partial<DatasetMetaVO>) =>
    http<DatasetDetailVO>('PATCH', `/dataset/${id}`, data),
  putFields: (id: string, fields: DatasetFieldVO[]) =>
    http<DatasetDetailVO>('PUT', `/dataset/${id}/fields`, fields),
  remove: (id: string) => http<void>('DELETE', `/dataset/${id}`),
  preview: (id: string) =>
    http<{
      columns: Array<{ name: string; type?: string; dataType?: string }>
      rows: unknown[][]
      sql?: string
    }>('POST', `/dataset/${id}/preview`),
  importFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetchForm<DatasetDetailVO>('/dataset/import', form)
  },
  /** 字段自学习画像（角色/统计/采样） */
  profile: (id: string) =>
    http<{
      fields: Array<{
        name: string
        label?: string
        role?: string
        roleSource?: string
        dataType?: string
        distinctCount?: number
        nullRate?: number
        distinctValues?: unknown[]
      }>
      sample?: unknown[][]
      measures?: Array<{ name: string }>
      dims?: Array<{ name: string }>
    }>('GET', `/dataset/${id}/profile`),
  /** 启动字段自学习（异步任务） */
  startLearn: (id: string) =>
    apiFetch<{
      ok: boolean
      jobId: string
      status: string
      phase?: string
      phaseLabel?: string
    }>(`/dataset/${id}/learn`, { method: 'POST', timeoutMs: 15_000 }),
  learnJob: (id: string, jobId: string) =>
    apiFetch<{
      ok: boolean
      jobId: string
      status: string
      phase?: string
      phaseLabel?: string
      error?: string
      result?: {
        ok?: boolean
        cancelled?: boolean
        fieldCount?: number
        dimensionCount?: number
        roleCounts?: Record<string, number>
        llmReviewed?: boolean
        llmChanged?: number
        llmSkipReason?: string
        error?: string
      }
    }>(`/dataset/${id}/learn/${jobId}`),
  cancelLearn: (id: string, jobId: string) =>
    apiFetch<{ ok: boolean; status?: string }>(`/dataset/${id}/learn/${jobId}`, { method: 'DELETE' }),
}

export type GlossaryItemVO = {
  id: number
  term: string
  type: string
  datasetId?: string
  canonicalField?: string
  aliases?: string[]
  values?: unknown[]
  status: string
  source?: string
  confidence?: number
  createdAt?: number
  updatedAt?: number
}

export const glossaryApi = {
  list: (type?: string, status?: string) =>
    http<GlossaryItemVO[]>(
      'GET',
      `/glossary${type || status ? `?${type ? `type=${type}` : ''}${type && status ? '&' : ''}${status ? `status=${status}` : ''}` : ''}`
    ),
  create: (body: {
    term: string
    type: string
    datasetId: string
    canonicalField: string
    aliases?: string[]
    values?: unknown[]
    status?: string
    confidence?: number
    source?: string
  }) => http<GlossaryItemVO>('POST', '/glossary', body),
  confirm: (id: number) => http<GlossaryItemVO>('POST', `/glossary/${id}/confirm`),
  updateValues: (id: number, values: unknown[]) =>
    http<GlossaryItemVO>('PUT', `/glossary/${id}/values`, { values }),
  rename: (id: number, term: string, aliases?: string[]) =>
    http<GlossaryItemVO>('PUT', `/glossary/${id}/rename`, { term, aliases: aliases || [] }),
  remove: (id: number) => http<void>('DELETE', `/glossary/${id}`)
}

/** 指标注册表（阶段2「指标确认」：draft → confirmed，agg/unit 权威口径） */
export type IndicatorVO = {
  id: number
  datasetId: string
  fieldName: string
  name: string
  agg?: string
  unit?: string
  formula?: string
  description?: string
  status: 'draft' | 'confirmed' | 'deprecated'
  source?: string
  confidence?: number
  createdAt?: number
  updatedAt?: number
}

export type IndicatorUpsertBody = {
  datasetId: string
  fieldName: string
  name: string
  agg?: string
  unit?: string
  formula?: string
  description?: string
  status?: string
  confidence?: number
}

export const indicatorApi = {
  byDataset: (datasetId: string) => http<IndicatorVO[]>('GET', `/indicators/dataset/${datasetId}`),
  create: (body: IndicatorUpsertBody) => http<IndicatorVO>('POST', '/indicators', body),
  confirm: (id: number) => http<IndicatorVO>('POST', `/indicators/${id}/confirm`),
  deprecate: (id: number) => http<IndicatorVO>('POST', `/indicators/${id}/deprecate`),
  remove: (id: number) => http<void>('DELETE', `/indicators/${id}`)
}

/** 高频问法（few-shot）：自然语言 → 标准 SQL，问数生成时注入 */
export type DatasetQuestionVO = {
  id: number
  datasetId: string
  question: string
  sql: string
  chartType?: string
  brief?: string
  status: 'active' | 'disabled'
  hitCount?: number
  createdAt?: number
  updatedAt?: number
}

export type QuestionUpsertBody = {
  datasetId?: string
  question: string
  sql: string
  chartType?: string
  brief?: string
  status?: string
}

export const questionApi = {
  byDataset: (datasetId: string) => http<DatasetQuestionVO[]>('GET', `/dataset/${datasetId}/questions`),
  create: (datasetId: string, body: QuestionUpsertBody) =>
    http<DatasetQuestionVO>('POST', `/dataset/${datasetId}/questions`, body),
  update: (datasetId: string, id: number, body: QuestionUpsertBody) =>
    http<DatasetQuestionVO>('PUT', `/dataset/${datasetId}/questions/${id}`, body),
  toggle: (datasetId: string, id: number, status: 'active' | 'disabled') =>
    http<DatasetQuestionVO>('POST', `/dataset/${datasetId}/questions/${id}/toggle`, { status }),
  remove: (datasetId: string, id: number) => http<void>('DELETE', `/dataset/${datasetId}/questions/${id}`)
}
