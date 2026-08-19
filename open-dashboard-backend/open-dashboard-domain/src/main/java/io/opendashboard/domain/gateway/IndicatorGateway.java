package io.opendashboard.domain.gateway;

import io.opendashboard.domain.DatasetDtos.IndicatorUpsertRequest;
import io.opendashboard.domain.DatasetDtos.IndicatorVO;

import java.util.List;
import java.util.Optional;

/**
 * 指标注册表存储（de_indicator）：候选 draft + 人工确认 confirmed 的权威指标口径。
 * JDBC impl in infrastructure; KnowledgeService / learner call through this port.
 */
public interface IndicatorGateway {

    IndicatorVO upsert(IndicatorUpsertRequest req);

    /** 按数据集列出（draft + confirmed + deprecated，按 status/confidence 排序）。 */
    List<IndicatorVO> listByDataset(String datasetId);

    /** 仅 confirmed（harness <knowledge> 注入与 od_plan_charts 选指标用）。 */
    List<IndicatorVO> listConfirmed(String datasetId);

    List<IndicatorVO> listConfirmedForDatasets(List<String> datasetIds);

    Optional<IndicatorVO> find(Long id);

    Optional<IndicatorVO> findByField(String datasetId, String fieldName);

    Optional<IndicatorVO> updateStatus(Long id, String status);

    /** 生成验证/LLM 语义解释回写 confidence（自学习闭环）。 */
    Optional<IndicatorVO> updateConfidence(Long id, double confidence);

    boolean delete(Long id);
}
