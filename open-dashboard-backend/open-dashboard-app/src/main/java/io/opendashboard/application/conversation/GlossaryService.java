package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.GlossaryItemVO;
import io.opendashboard.domain.DatasetDtos.GlossaryUpsertRequest;
import io.opendashboard.domain.gateway.GlossaryGateway;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * 公共维度 / 业务词表服务（阶段2）：列表、确认、改名、删除。
 * 供「维度管理」菜单与问数/生成消费。
 */
@Service
public class GlossaryService {

    private final ObjectProvider<GlossaryGateway> store;

    public GlossaryService(ObjectProvider<GlossaryGateway> store) {
        this.store = store;
    }

    public List<GlossaryItemVO> list(String type, String status) {
        GlossaryGateway g = store.getIfAvailable();
        return g == null ? List.of() : g.list(type, status);
    }

    public List<GlossaryItemVO> listByDataset(String datasetId) {
        GlossaryGateway g = store.getIfAvailable();
        return g == null ? List.of() : g.listByDataset(datasetId);
    }

    public Optional<GlossaryItemVO> confirm(Long id) {
        GlossaryGateway g = store.getIfAvailable();
        return g == null ? Optional.empty() : g.updateStatus(id, "confirmed");
    }

    public Optional<GlossaryItemVO> rename(Long id, String term, List<String> aliases) {
        GlossaryGateway g = store.getIfAvailable();
        if (g == null) return Optional.empty();
        if (term == null || term.isBlank()) return Optional.empty();
        return g.updateName(id, term, aliases);
    }

    /** 维度值配置：更新某条目 values_json（人工维护的枚举值）。 */
    public Optional<GlossaryItemVO> updateValues(Long id, List<Object> values) {
        GlossaryGateway g = store.getIfAvailable();
        return g == null ? Optional.empty() : g.updateValues(id, values);
    }

    /** 数据集字段的维度值配置：无词条则新建（term=label，canonical=field），有则更新 values。 */
    public Optional<GlossaryItemVO> configureFieldValues(
            String datasetId, String fieldName, String label, List<Object> values
    ) {
        GlossaryGateway g = store.getIfAvailable();
        if (g == null || datasetId == null || datasetId.isBlank() || fieldName == null || fieldName.isBlank()) {
            return Optional.empty();
        }
        List<GlossaryItemVO> existing = g.listByDataset(datasetId).stream()
                .filter(x -> fieldName.equals(x.canonicalField()) && "dimension".equals(x.type()))
                .findFirst().map(List::of).orElse(List.of());
        if (!existing.isEmpty()) {
            return g.updateValues(existing.getFirst().id(), values == null ? List.of() : values);
        }
        String term = label == null || label.isBlank() ? fieldName : label;
        return Optional.ofNullable(g.upsert(new GlossaryUpsertRequest(
                term, "dimension", datasetId, fieldName, List.of(term),
                values == null ? List.of() : values,
                "candidate", 0.8, "manual"
        )));
    }

    public Optional<GlossaryItemVO> upsert(GlossaryUpsertRequest req) {
        GlossaryGateway g = store.getIfAvailable();
        return g == null ? Optional.empty() : Optional.ofNullable(g.upsert(req));
    }

    public boolean delete(Long id) {
        GlossaryGateway g = store.getIfAvailable();
        return g != null && g.delete(id);
    }
}
