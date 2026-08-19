package io.opendashboard.domain.gateway;

import io.opendashboard.domain.DatasetDtos.FieldProfileVO;

import java.util.List;

/**
 * Field self-learning profile storage (阶段1 数据集自学习).
 * JDBC impl lives in infrastructure; app-side learner calls through this port.
 */
public interface FieldProfileGateway {

    void save(FieldProfileVO profile);

    List<FieldProfileVO> listByDataset(String datasetId);

    void deleteByDataset(String datasetId);
}
