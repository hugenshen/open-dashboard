package io.opendashboard.domain.gateway;

import io.opendashboard.domain.DatasetDtos.GlossaryItemVO;
import io.opendashboard.domain.DatasetDtos.GlossaryUpsertRequest;

import java.util.List;
import java.util.Optional;

/**
 * 业务词表 / 公共维度存储（de_glossary）。
 * JDBC impl in infrastructure; learner + dimension controller call through this port.
 */
public interface GlossaryGateway {

    GlossaryItemVO upsert(GlossaryUpsertRequest req);

    List<GlossaryItemVO> list(String type, String status);

    List<GlossaryItemVO> listByDataset(String datasetId);

    Optional<GlossaryItemVO> find(Long id);

    Optional<GlossaryItemVO> updateStatus(Long id, String status);

    Optional<GlossaryItemVO> updateName(Long id, String term, List<String> aliases);

    /** 维度值配置：更新条目 values_json（人工维护的枚举值集合）。 */
    Optional<GlossaryItemVO> updateValues(Long id, List<Object> values);

    boolean delete(Long id);
}
