package io.opendashboard.application;

import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.exception.ForbiddenException;
import io.opendashboard.domain.exception.ResourceForbiddenException;
import io.opendashboard.domain.exception.UnauthorizedException;
import io.opendashboard.domain.gateway.IdentityRepository;
import io.opendashboard.domain.gateway.ResourceAccessPort;
import io.opendashboard.domain.gateway.ResourceAccessPort.AclGrant;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * L2 resource ACL. Askable and chartQuery share this; do not duplicate gates.
 */
@Service
public class EffectiveAccessService {

    private static final Set<String> DATASET_USE = Set.of("use", "manage", "owner");
    private static final Set<String> DASHBOARD_VIEW = Set.of("view", "edit", "manage", "owner");
    private static final Set<String> DASHBOARD_WRITE = Set.of("edit", "manage", "owner");

    private final ObjectProvider<ResourceAccessPort> store;
    private final IdentityRepository identity;

    public EffectiveAccessService(ObjectProvider<ResourceAccessPort> store, IdentityRepository identity) {
        this.store = store;
        this.identity = identity;
    }

    public boolean canUseDataset(AuthPrincipal principal, String datasetId) {
        if (principal == null || datasetId == null || datasetId.isBlank()) return false;
        if (isDataAdmin(principal)) return true;
        return hasAction(principal, "dataset", datasetId, DATASET_USE);
    }

    public boolean canViewDashboard(AuthPrincipal principal, String dashboardId) {
        if (principal == null || dashboardId == null || dashboardId.isBlank()) return false;
        if (isWorkspaceAdmin(principal) || principal.hasPermission("dashboard:manage")) return true;
        return hasAction(principal, "dashboard", dashboardId, DASHBOARD_VIEW);
    }

    public boolean canWriteDashboard(AuthPrincipal principal, String dashboardId) {
        if (principal == null || dashboardId == null || dashboardId.isBlank()) return false;
        if (isWorkspaceAdmin(principal) || principal.hasPermission("dashboard:manage")) return true;
        return hasAction(principal, "dashboard", dashboardId, DASHBOARD_WRITE);
    }

    public Set<String> grantedDashboardIds(AuthPrincipal principal) {
        if (principal == null) return Set.of();
        ResourceAccessPort port = store.getIfAvailable();
        if (port == null) return Set.of();
        Set<String> keys = subjectKeys(principal);
        Set<String> out = new LinkedHashSet<>();
        for (AclGrant g : port.listByWorkspace(principal.workspaceId(), "dashboard")) {
            if (match(keys, g) && DASHBOARD_VIEW.contains(g.action())) {
                out.add(g.resourceId());
            }
        }
        return out;
    }

    public Set<String> grantedDatasetIds(AuthPrincipal principal) {
        if (principal == null) return Set.of();
        ResourceAccessPort port = store.getIfAvailable();
        if (port == null) return Set.of();
        Set<String> keys = subjectKeys(principal);
        Set<String> out = new LinkedHashSet<>();
        for (AclGrant g : port.listByWorkspace(principal.workspaceId(), "dataset")) {
            if (match(keys, g) && DATASET_USE.contains(g.action())) {
                out.add(g.resourceId());
            }
        }
        return out;
    }

    public void requireDatasetUse(String datasetId) {
        requireDatasetUse(AuthContext.get(), datasetId);
    }

    public void requireDatasetUse(AuthPrincipal principal, String datasetId) {
        if (principal == null) {
            throw new UnauthorizedException("Authentication required");
        }
        if (!canUseDataset(principal, datasetId)) {
            throw new ForbiddenException("DATASET_UNAVAILABLE: " + datasetId);
        }
    }

    public void requireDatasetVisible(String datasetId) {
        AuthPrincipal principal = AuthContext.get();
        if (principal == null) {
            throw new UnauthorizedException("Authentication required");
        }
        if (!canUseDataset(principal, datasetId)) {
            throw new ResourceForbiddenException("RESOURCE_FORBIDDEN");
        }
    }

    public void requireDashboardView(String dashboardId) {
        requireDashboardView(AuthContext.get(), dashboardId);
    }

    public void requireDashboardView(AuthPrincipal principal, String dashboardId) {
        if (principal == null) {
            throw new UnauthorizedException("Authentication required");
        }
        if (!canViewDashboard(principal, dashboardId)) {
            throw new ResourceForbiddenException("RESOURCE_FORBIDDEN");
        }
    }

    public void requireDashboardWrite(AuthPrincipal principal, String dashboardId) {
        if (principal == null) {
            throw new UnauthorizedException("Authentication required");
        }
        if (!canWriteDashboard(principal, dashboardId)) {
            throw new ForbiddenException("DASHBOARD_WRITE_FORBIDDEN");
        }
    }

    public static boolean isDataAdmin(AuthPrincipal principal) {
        return principal != null && (
                principal.hasPermission("*")
                        || principal.hasPermission("platform:admin")
                        || principal.hasPermission("dataset:manage")
                        || principal.hasPermission("workspace:admin"));
    }

    public static boolean isWorkspaceAdmin(AuthPrincipal principal) {
        return principal != null && (
                principal.hasPermission("*")
                        || principal.hasPermission("platform:admin")
                        || principal.hasPermission("workspace:admin")
                        || principal.hasPermission("workspace:manage_member"));
    }

    private boolean hasAction(AuthPrincipal principal, String resourceType, String resourceId, Set<String> actions) {
        ResourceAccessPort port = store.getIfAvailable();
        if (port == null) return false;
        Set<String> keys = subjectKeys(principal);
        for (AclGrant g : port.listByResource(principal.workspaceId(), resourceType, resourceId)) {
            if (match(keys, g) && actions.contains(g.action())) return true;
        }
        return false;
    }

    private Set<String> subjectKeys(AuthPrincipal principal) {
        Set<String> keys = new LinkedHashSet<>();
        keys.add("user:" + principal.userId());
        for (String role : identity.rolesForUser(principal.userId(), principal.workspaceId())) {
            keys.add("role:" + role);
        }
        return keys;
    }

    private static boolean match(Set<String> keys, AclGrant grant) {
        return keys.contains(grant.subjectType() + ":" + grant.subjectId());
    }
}
