package io.opendashboard.application;

import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * P008 askable set: conversation:use ∩ dataset:use.
 * Resource-level ACL tables are out of scope (governance follow-up).
 */
@Service
public class AskableDatasetService {

    private final DatasetService datasets;

    public AskableDatasetService(DatasetService datasets) {
        this.datasets = datasets;
    }

    public boolean canAsk(AuthPrincipal principal) {
        if (principal == null) {
            return false;
        }
        return principal.hasPermission("conversation:use")
                && (principal.hasPermission("dataset:use") || principal.hasPermission("dataset:manage"));
    }

    public boolean canAsk() {
        return canAsk(AuthContext.get());
    }

    public List<DatasetMetaVO> listAskable() {
        if (!canAsk()) {
            return List.of();
        }
        return datasets.list();
    }

    public boolean isAskable(String datasetId) {
        if (datasetId == null || datasetId.isBlank()) {
            return false;
        }
        return listAskable().stream().anyMatch(d -> datasetId.equals(d.id()));
    }

    public void requireAskable(String datasetId) {
        if (!isAskable(datasetId)) {
            throw new IllegalArgumentException("DATASET_UNAVAILABLE: " + datasetId);
        }
    }

    public List<String> askableIds() {
        return listAskable().stream().map(DatasetMetaVO::id).collect(Collectors.toList());
    }
}
