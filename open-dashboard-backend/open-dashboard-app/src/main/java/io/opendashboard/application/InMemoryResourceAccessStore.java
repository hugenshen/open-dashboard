package io.opendashboard.application;

import io.opendashboard.domain.gateway.ResourceAccessPort;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
@Profile("stub")
public class InMemoryResourceAccessStore implements ResourceAccessPort {

    private final CopyOnWriteArrayList<AclGrant> grants = new CopyOnWriteArrayList<>();
    private final CopyOnWriteArrayList<DataPolicy> policies = new CopyOnWriteArrayList<>();
    private final CopyOnWriteArrayList<DatasetRequest> requests = new CopyOnWriteArrayList<>();

    public InMemoryResourceAccessStore() {
        long now = System.currentTimeMillis();
        for (String ds : List.of("ds_sales", "ds_ops", "ds_fin", "ds_order")) {
            for (String role : List.of("workspace_admin", "platform_admin")) {
                grants.add(new AclGrant(
                        "acl-" + role + "-" + ds,
                        "workspace-retail",
                        "dataset",
                        ds,
                        "role",
                        role,
                        "manage",
                        now,
                        "system"
                ));
            }
            grants.add(new AclGrant(
                    "acl-u-analyst-" + ds,
                    "workspace-retail",
                    "dataset",
                    ds,
                    "user",
                    "u_analyst",
                    "use",
                    now,
                    "system"
            ));
        }
        for (String role : List.of("workspace_admin", "platform_admin")) {
            grants.add(new AclGrant(
                    "acl-dash-" + role + "-1",
                    "workspace-retail",
                    "dashboard",
                    "1",
                    "role",
                    role,
                    "manage",
                    now,
                    "system"
            ));
        }
        grants.add(new AclGrant(
                "acl-u-analyst-dash-1",
                "workspace-retail",
                "dashboard",
                "1",
                "user",
                "u_analyst",
                "edit",
                now,
                "system"
        ));
    }

    @Override
    public List<AclGrant> listByResource(String workspaceId, String resourceType, String resourceId) {
        return grants.stream()
                .filter(g -> g.workspaceId().equals(workspaceId)
                        && g.resourceType().equals(resourceType)
                        && g.resourceId().equals(resourceId))
                .toList();
    }

    @Override
    public List<AclGrant> listByWorkspace(String workspaceId, String resourceType) {
        return grants.stream()
                .filter(g -> g.workspaceId().equals(workspaceId) && g.resourceType().equals(resourceType))
                .toList();
    }

    @Override
    public void upsertGrant(AclGrant grant) {
        grants.removeIf(g -> g.workspaceId().equals(grant.workspaceId())
                && g.resourceType().equals(grant.resourceType())
                && g.resourceId().equals(grant.resourceId())
                && g.subjectType().equals(grant.subjectType())
                && g.subjectId().equals(grant.subjectId())
                && g.action().equals(grant.action()));
        grants.add(grant);
    }

    @Override
    public void deleteGrant(String id) {
        grants.removeIf(g -> g.id().equals(id));
    }

    @Override
    public List<DataPolicy> listPolicies(String workspaceId, String datasetId) {
        return policies.stream()
                .filter(p -> p.workspaceId().equals(workspaceId) && p.datasetId().equals(datasetId))
                .toList();
    }

    @Override
    public List<DataPolicy> listPolicies(String workspaceId) {
        return policies.stream().filter(p -> p.workspaceId().equals(workspaceId)).toList();
    }

    @Override
    public void upsertPolicy(DataPolicy policy) {
        policies.removeIf(p -> p.id().equals(policy.id()));
        policies.add(policy);
    }

    @Override
    public void deletePolicy(String id) {
        policies.removeIf(p -> p.id().equals(id));
    }

    @Override
    public List<DatasetRequest> listRequests(String workspaceId) {
        return requests.stream().filter(r -> r.workspaceId().equals(workspaceId)).toList();
    }

    @Override
    public void upsertRequest(DatasetRequest request) {
        requests.removeIf(r -> r.id().equals(request.id()));
        requests.add(request);
    }
}
