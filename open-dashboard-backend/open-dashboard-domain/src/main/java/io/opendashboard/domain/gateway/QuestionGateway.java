package io.opendashboard.domain.gateway;

import io.opendashboard.domain.DatasetDtos.DatasetQuestionVO;
import io.opendashboard.domain.DatasetDtos.QuestionUpsertRequest;

import java.util.List;
import java.util.Optional;

/**
 * 高频问题存储（de_dataset_question）：few-shot 示例，SQLBot 生成 SQL 时注入。
 * JDBC impl in infrastructure; QuestionService / harness 消费。
 */
public interface QuestionGateway {

    DatasetQuestionVO upsert(QuestionUpsertRequest req);

    /** 按 id 更新 question/sql/chart_type/brief/status。 */
    Optional<DatasetQuestionVO> update(Long id, QuestionUpsertRequest req);

    List<DatasetQuestionVO> listByDataset(String datasetId, String status);

    /** harness few-shot 用：某数据集 active 问题（按 hitCount/updated 排序）。 */
    List<DatasetQuestionVO> listActive(String datasetId, int limit);

    Optional<DatasetQuestionVO> find(Long id);

    Optional<DatasetQuestionVO> updateStatus(Long id, String status);

    /** 命中次数 +1（用户问题匹配该 few-shot 示例时）。 */
    Optional<DatasetQuestionVO> bumpHit(Long id);

    boolean delete(Long id);
}
