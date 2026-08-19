package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.DatasetQuestionVO;
import io.opendashboard.domain.DatasetDtos.QuestionUpsertRequest;
import io.opendashboard.domain.gateway.QuestionGateway;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * 高频问题服务（few-shot 示例）：数据集页维护「问题→标准 SQL」，SQLBot 生成时注入。
 */
@Service
public class QuestionService {

    private final ObjectProvider<QuestionGateway> store;

    public QuestionService(ObjectProvider<QuestionGateway> store) {
        this.store = store;
    }

    public List<DatasetQuestionVO> listByDataset(String datasetId) {
        QuestionGateway g = store.getIfAvailable();
        return g == null ? List.of() : g.listByDataset(datasetId, null);
    }

    /** harness few-shot：某数据集 active 问题（≤limit 条）。 */
    public List<DatasetQuestionVO> listActive(String datasetId, int limit) {
        QuestionGateway g = store.getIfAvailable();
        return g == null ? List.of() : g.listActive(datasetId, Math.max(1, Math.min(limit, 20)));
    }

    public Optional<DatasetQuestionVO> create(QuestionUpsertRequest req) {
        QuestionGateway g = store.getIfAvailable();
        if (g == null || req == null || req.datasetId() == null || req.datasetId().isBlank()
                || req.question() == null || req.question().isBlank() || req.sql() == null || req.sql().isBlank()) {
            return Optional.empty();
        }
        return Optional.ofNullable(g.upsert(req));
    }

    public Optional<DatasetQuestionVO> update(Long id, QuestionUpsertRequest req) {
        QuestionGateway g = store.getIfAvailable();
        if (g == null || req == null || req.question() == null || req.question().isBlank()
                || req.sql() == null || req.sql().isBlank()) {
            return Optional.empty();
        }
        return g.update(id, req);
    }

    public Optional<DatasetQuestionVO> toggle(Long id, String status) {
        QuestionGateway g = store.getIfAvailable();
        if (g == null || (status == null || status.isBlank())) return Optional.empty();
        String s = "active".equals(status) ? "active" : "disabled";
        return g.updateStatus(id, s);
    }

    public boolean delete(Long id) {
        QuestionGateway g = store.getIfAvailable();
        return g != null && g.delete(id);
    }

    /** few-shot 命中：用户问题匹配该示例时计数 +1（高频问题排序用）。 */
    public Optional<DatasetQuestionVO> bumpHit(Long id) {
        QuestionGateway g = store.getIfAvailable();
        return g == null ? Optional.empty() : g.bumpHit(id);
    }
}
