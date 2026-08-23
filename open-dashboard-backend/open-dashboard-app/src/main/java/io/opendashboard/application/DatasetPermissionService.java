package io.opendashboard.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.DatasetPermissionDtos.DatasetPermissionBundle;
import io.opendashboard.domain.DatasetPermissionDtos.GrantRequest;
import io.opendashboard.domain.DatasetPermissionDtos.GrantVO;
import io.opendashboard.domain.DatasetPermissionDtos.MemberOption;
import io.opendashboard.domain.DatasetPermissionDtos.PolicyVO;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.exception.ForbiddenException;
import io.opendashboard.domain.gateway.IdentityRepository;
import io.opendashboard.domain.gateway.IdentityRepository.MemberRow;
import io.opendashboard.domain.gateway.ResourceAccessPort;
import io.opendashboard.domain.gateway.ResourceAccessPort.AclGrant;
import io.opendashboard.domain.gateway.ResourceAccessPort.DataPolicy;
import io.opendashboard.domain.gateway.ResourceAccessPort.DatasetRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class DatasetPermissionService {

    private final ObjectProvider<ResourceAccessPort> store;
    private final IdentityRepository identity;
    private final DatasetService datasets;
    private final ObjectMapper mapper = new ObjectMapper();

    public DatasetPermissionService(
            ObjectProvider<ResourceAccessPort> store,
            IdentityRepository identity,
            DatasetService datasets
    ) {
        this.store = store;
        this.identity = identity;
        this.datasets = datasets;
    }

    public DatasetPermissionBundle bundle(String workspaceId, AuthPrincipal principal) {
        requireAdmin(principal);
        ResourceAccessPort port = store.getIfAvailable();
        List<Map<String, String>> ds = new ArrayList<>();
        for (DatasetMetaVO m : datasets.list()) {
            Map<String, String> row = new LinkedHashMap<>();
            row.put("id", m.id());
            row.put("name", m.name());
            row.put("tableName", m.tableName() == null ? "" : m.tableName());
            ds.add(row);
        }
        List<MemberOption> members = new ArrayList<>();
        for (MemberRow m : identity.listMembers(workspaceId)) {
            members.add(new MemberOption(
                    m.userId(),
                    m.displayName(),
                    m.username(),
                    List.of(m.roleCode())
            ));
        }
        Map<String, String> labels = labels(members);
        List<GrantVO> grants = new ArrayList<>();
        List<PolicyVO> policies = new ArrayList<>();
        if (port != null) {
            try {
                for (AclGrant g : port.listByWorkspace(workspaceId, "dataset")) {
                    grants.add(new GrantVO(
                            g.id(),
                            g.resourceId(),
                            g.subjectType(),
                            g.subjectId(),
                            labelOf(g.subjectType(), g.subjectId(), labels),
                            g.action()
                    ));
                }
                for (DataPolicy p : port.listPolicies(workspaceId)) {
                    policies.add(new PolicyVO(
                            p.id(),
                            p.datasetId(),
                            p.subjectType(),
                            p.subjectId(),
                            labelOf(p.subjectType(), p.subjectId(), labels),
                            p.kind(),
                            p.effect(),
                            parseMap(p.predicateJson()),
                            p.enabled()
                    ));
                }
            } catch (RuntimeException ignored) {
                // ACL 表未迁移时仍返回数据集和成员，避免管理端下拉全空
            }
        }
        return new DatasetPermissionBundle(ds, members, grants, policies);
    }

    public GrantVO grant(String workspaceId, GrantRequest req, AuthPrincipal principal) {
        requireAdmin(principal);
        if (req == null || req.datasetId() == null || req.datasetId().isBlank()) {
            throw new IllegalArgumentException("datasetId required");
        }
        if (req.subjectId() == null || req.subjectId().isBlank()) {
            throw new IllegalArgumentException("subjectId required");
        }
        String subjectType = req.subjectType() == null || req.subjectType().isBlank() ? "user" : req.subjectType();
        String action = req.action() == null || req.action().isBlank() ? "use" : req.action();
        ResourceAccessPort port = requireStore();
        long now = System.currentTimeMillis();
        AclGrant grant = new AclGrant(
                "acl-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16),
                workspaceId,
                "dataset",
                req.datasetId(),
                subjectType,
                req.subjectId(),
                action,
                now,
                principal.userId()
        );
        port.upsertGrant(grant);
        if (req.rowField() != null && !req.rowField().isBlank() && req.rowValue() != null && !req.rowValue().isBlank()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("field", req.rowField());
            item.put("op", req.rowOp() == null || req.rowOp().isBlank() ? "eq" : req.rowOp());
            item.put("value", req.rowValue());
            Map<String, Object> pred = Map.of("items", List.of(item));
            port.upsertPolicy(new DataPolicy(
                    "pol-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16),
                    workspaceId,
                    req.datasetId(),
                    "row",
                    subjectType,
                    req.subjectId(),
                    "filter",
                    writeJson(pred),
                    true,
                    now,
                    now
            ));
        }
        if (req.hideColumns() != null && !req.hideColumns().isEmpty()) {
            Map<String, Object> pred = Map.of("hide", req.hideColumns());
            port.upsertPolicy(new DataPolicy(
                    "pol-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16),
                    workspaceId,
                    req.datasetId(),
                    "column",
                    subjectType,
                    req.subjectId(),
                    "hide",
                    writeJson(pred),
                    true,
                    now,
                    now
            ));
        }
        return new GrantVO(grant.id(), grant.resourceId(), grant.subjectType(), grant.subjectId(),
                req.subjectId(), grant.action());
    }

    public void deleteGrant(String workspaceId, String grantId, AuthPrincipal principal) {
        requireAdmin(principal);
        requireStore().deleteGrant(grantId);
    }

    public void deletePolicy(String workspaceId, String policyId, AuthPrincipal principal) {
        requireAdmin(principal);
        requireStore().deletePolicy(policyId);
    }

    public void grantOwner(String resourceType, String resourceId, AuthPrincipal principal) {
        if (principal == null || resourceId == null || resourceId.isBlank()) return;
        ResourceAccessPort port = store.getIfAvailable();
        if (port == null) return;
        String action = "dataset".equals(resourceType) ? "owner" : "owner";
        port.upsertGrant(new AclGrant(
                "acl-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16),
                principal.workspaceId(),
                resourceType,
                resourceId,
                "user",
                principal.userId(),
                action,
                System.currentTimeMillis(),
                principal.userId()
        ));
    }

    public String recordRequest(String workspaceId, String datasetId, String purpose, List<String> actions, AuthPrincipal principal) {
        ResourceAccessPort port = store.getIfAvailable();
        if (port == null || principal == null) return null;
        String acts = actions == null || actions.isEmpty() ? "use" : String.join(",", actions);
        String id = "req-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        port.upsertRequest(new DatasetRequest(
                id,
                workspaceId,
                datasetId,
                principal.userId(),
                purpose,
                acts,
                "pending",
                System.currentTimeMillis(),
                null,
                null
        ));
        return id;
    }

    public GrantVO approveRequest(String workspaceId, String requestId, AuthPrincipal principal) {
        requireAdmin(principal);
        ResourceAccessPort port = requireStore();
        DatasetRequest found = port.listRequests(workspaceId).stream()
                .filter(r -> requestId.equals(r.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("request not found"));
        if (!"pending".equals(found.status())) {
            throw new IllegalArgumentException("request already decided");
        }
        long now = System.currentTimeMillis();
        port.upsertRequest(new DatasetRequest(
                found.id(),
                found.workspaceId(),
                found.datasetId(),
                found.applicantId(),
                found.purpose(),
                found.requestedActions(),
                "approved",
                found.createdAt(),
                principal.userId(),
                now
        ));
        return grant(workspaceId, new GrantRequest(
                found.datasetId(),
                "user",
                found.applicantId(),
                "use",
                null,
                null,
                null,
                null
        ), principal);
    }

    public void rejectRequest(String workspaceId, String requestId, AuthPrincipal principal) {
        requireAdmin(principal);
        ResourceAccessPort port = requireStore();
        DatasetRequest found = port.listRequests(workspaceId).stream()
                .filter(r -> requestId.equals(r.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("request not found"));
        port.upsertRequest(new DatasetRequest(
                found.id(),
                found.workspaceId(),
                found.datasetId(),
                found.applicantId(),
                found.purpose(),
                found.requestedActions(),
                "rejected",
                found.createdAt(),
                principal.userId(),
                System.currentTimeMillis()
        ));
    }

    private ResourceAccessPort requireStore() {
        ResourceAccessPort port = store.getIfAvailable();
        if (port == null) {
            throw new IllegalStateException("resource ACL store unavailable");
        }
        return port;
    }

    private static void requireAdmin(AuthPrincipal principal) {
        if (!EffectiveAccessService.isWorkspaceAdmin(principal)) {
            throw new ForbiddenException("需要工作区管理权限");
        }
    }

    private static Map<String, String> labels(List<MemberOption> members) {
        Map<String, String> out = new LinkedHashMap<>();
        for (MemberOption m : members) {
            out.put("user:" + m.userId(), m.displayName());
        }
        out.put("role:analyst", "分析师");
        out.put("role:workspace_admin", "工作区管理员");
        out.put("role:platform_admin", "平台管理员");
        out.put("role:viewer", "浏览者");
        return out;
    }

    private static String labelOf(String type, String id, Map<String, String> labels) {
        String key = type + ":" + id;
        return labels.getOrDefault(key, id);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseMap(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return mapper.readValue(json, Map.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    private String writeJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new ForbiddenException("POLICY_BIND_FAILED");
        }
    }
}
