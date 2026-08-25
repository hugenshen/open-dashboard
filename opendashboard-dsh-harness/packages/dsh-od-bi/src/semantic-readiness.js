/**
 * P015 M0 semantic readiness gate for full-board generation.
 * Stored profile evidence or confirmed metrics are required; raw schema alone is insufficient.
 */

import { looksLikeIdentifier, semanticRole } from './gen-board.js'

function list(value) {
  return Array.isArray(value) ? value : []
}

function profileEvidenceCount(profile) {
  const explicit = Number(profile?.profileFieldCount)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  return list(profile?.fields).filter((f) => {
    const source = String(f?.roleSource || '').toLowerCase()
    return source && source !== 'schema' && source !== 'name'
  }).length
}

/**
 * @returns {{ ready: boolean, reasons: string[], evidence: object }}
 */
export function assessSemanticReadiness({ fields, profile, knowledge } = {}) {
  const sourceFields = list(fields)
  const metrics = list(knowledge?.metrics)
  const profileCount = profileEvidenceCount(profile)
  const explicitCoverage = Number(profile?.profileCoverage)
  const coverage = Number.isFinite(explicitCoverage)
    ? explicitCoverage
    : (sourceFields.length ? profileCount / sourceFields.length : 0)
  const profileReady = profile?.profileReady === true || (profileCount > 0 && coverage >= 0.5)
  const confirmedMetricCount = metrics.length
  const safeMeasureCount = sourceFields.filter((f) => semanticRole(f) === 'measure').length
  const countKeyCount = sourceFields.filter((f) => looksLikeIdentifier(f)).length
  const dimensionCount = sourceFields.filter((f) => ['dim', 'time'].includes(semanticRole(f))).length
  const weakDataset = profile?.weakDataset === true
  const reasons = []

  if (weakDataset) reasons.push('WEAK_DATASET')
  if (!profileReady && confirmedMetricCount === 0) reasons.push('PROFILE_OR_CONFIRMED_METRIC_MISSING')
  if (safeMeasureCount === 0 && confirmedMetricCount === 0 && countKeyCount === 0) reasons.push('NO_SAFE_METRIC')
  if (dimensionCount === 0) reasons.push('NO_USABLE_DIMENSION')

  return {
    ready: reasons.length === 0,
    reasons,
    evidence: {
      fieldCount: sourceFields.length,
      profileFieldCount: profileCount,
      profileCoverage: coverage,
      profileReady,
      confirmedMetricCount,
      safeMeasureCount,
      countKeyCount,
      dimensionCount,
      weakDataset,
    },
  }
}

export function semanticNotReadyMessage(result) {
  const reasons = list(result?.reasons)
  if (reasons.includes('WEAK_DATASET')) return '数据集不适合生成业务仪表盘，请更换数据集。'
  if (reasons.includes('PROFILE_OR_CONFIRMED_METRIC_MISSING')) {
    return '数据集字段语义尚未准备好，已阻止生成可能误导的仪表盘。请先完成字段学习或确认业务指标后重试。'
  }
  if (reasons.includes('NO_SAFE_METRIC')) return '数据集中没有可安全聚合的指标，暂不能生成仪表盘。'
  if (reasons.includes('NO_USABLE_DIMENSION')) return '数据集中没有可用于分析的维度，暂不能生成仪表盘。'
  return '数据集语义未就绪，暂不能生成仪表盘。'
}
