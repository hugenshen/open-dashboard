package io.opendashboard.application;

import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.exception.ForbiddenException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Askable set = conversation:use ∩ (dataset:manage | ACL use). No live[0] fallback.
 */
@Service
public class AskableDatasetService {

    private final DatasetService datasets;
    private final EffectiveAccessService access;

    public AskableDatasetService(DatasetService datasets, EffectiveAccessService access) {
        this.datasets = datasets;
        this.access = access;
    }

    public boolean canAsk(AuthPrincipal principal) {
        if (principal == null) {
            return false;
        }
        return principal.hasPermission("conversation:use");
    }

    public boolean canAsk() {
        return canAsk(AuthContext.get());
    }

    public List<DatasetMetaVO> listAskable() {
        AuthPrincipal principal = AuthContext.get();
        if (!canAsk(principal)) {
            return List.of();
        }
        List<DatasetMetaVO> live = datasets.list();
        if (EffectiveAccessService.isDataAdmin(principal)) {
            return live;
        }
        Set<String> granted = access.grantedDatasetIds(principal);
        return live.stream().filter(d -> granted.contains(d.id())).toList();
    }

    public boolean isAskable(String datasetId) {
        if (datasetId == null || datasetId.isBlank()) {
            return false;
        }
        return listAskable().stream().anyMatch(d -> datasetId.equals(d.id()));
    }

    public void requireAskable(String datasetId) {
        if (!isAskable(datasetId)) {
            throw new ForbiddenException("DATASET_UNAVAILABLE: " + datasetId);
        }
    }

    public List<String> askableIds() {
        return listAskable().stream().map(DatasetMetaVO::id).collect(Collectors.toList());
    }
}
