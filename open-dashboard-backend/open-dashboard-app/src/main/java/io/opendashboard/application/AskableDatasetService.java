package io.opendashboard.application;

import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * P008 askable set: conversation:use ∩ dataset:use, then plaza grants in visible workspaces.
 * Resource-level ACL tables remain a governance follow-up.
 */
@Service
public class AskableDatasetService {

    private final DatasetService datasets;
    private final WorkspaceGovernanceService governance;

    public AskableDatasetService(DatasetService datasets, WorkspaceGovernanceService governance) {
        this.datasets = datasets;
        this.governance = governance;
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
        AuthPrincipal principal = AuthContext.get();
        if (!canAsk(principal)) {
            return List.of();
        }
        List<DatasetMetaVO> live = datasets.list();
        if (principal.hasPermission("dataset:manage") || principal.hasPermission("platform:admin")
                || principal.hasPermission("*")) {
            return live;
        }
        Set<String> sources = new LinkedHashSet<>(governance.grantedAskableSources(principal));
        List<DatasetMetaVO> matched = live.stream()
                .filter(d -> sources.contains(d.id()) || (d.tableName() != null && sources.contains(d.tableName())))
                .toList();
        if (!matched.isEmpty()) {
            return matched;
        }
        if (!sources.isEmpty() && !live.isEmpty()) {
            return List.of(live.get(0));
        }
        return List.of();
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
