package io.opendashboard.application;

import io.opendashboard.domain.DashboardDtos.DashboardNodeVO;
import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.exception.ForbiddenException;
import io.opendashboard.domain.gateway.IdentityRepository;
import io.opendashboard.domain.gateway.ResourceAccessPort;
import io.opendashboard.domain.gateway.ResourceAccessPort.DatasetRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WorkspaceGovernanceService {

    private final Map<String, WorkspaceSeed> workspaces = new LinkedHashMap<>();
    private final Map<String, List<GroupSeed>> groups = new LinkedHashMap<>();
    private final Map<String, List<RoleSeed>> roles = new LinkedHashMap<>();
    private final Map<String, List<MemberSeed>> members = new LinkedHashMap<>();
    private final Set<String> addedAssets = ConcurrentHashMap.newKeySet();
    private final Map<String, DataRequestVO> requests = new ConcurrentHashMap<>();
    private final IdentityRepository identityRepository;
    private final DatasetService datasets;
    private final ObjectProvider<DashboardAppService> dashboards;
    private final ObjectProvider<EffectiveAccessService> access;
    private final ObjectProvider<DatasetPermissionService> permissions;
    private final ObjectProvider<ResourceAccessPort> resourceAccess;

    public WorkspaceGovernanceService(
            IdentityRepository identityRepository,
            DatasetService datasets,
            ObjectProvider<DashboardAppService> dashboards,
            ObjectProvider<EffectiveAccessService> access,
            ObjectProvider<DatasetPermissionService> permissions,
            ObjectProvider<ResourceAccessPort> resourceAccess
    ) {
        this.identityRepository = identityRepository;
        this.datasets = datasets;
        this.dashboards = dashboards;
        this.access = access;
        this.permissions = permissions;
        this.resourceAccess = resourceAccess;
        seedWorkspaces();
        seedSecurity();
    }

    public AuthMeVO me(AuthPrincipal principal) {
        String workspaceId = visibleWorkspaceId(principal, principal.workspaceId());
        return new AuthMeVO(
                principal.userId(),
                principal.displayName(),
                sorted(principal.permissions()),
                workspaceId,
                workspace(principal, workspaceId),
                workspaces(principal, workspaceId),
                groups(workspaceId, principal),
                rolesForPrincipal(workspaceId, principal),
                effectivePermissions(workspaceId, principal).permissions()
        );
    }

    public List<WorkspaceVO> workspaces(AuthPrincipal principal, String currentWorkspaceId) {
        String current = visibleWorkspaceId(principal, currentWorkspaceId);
        return visibleWorkspaceIds(principal).stream()
                .map(workspaces::get)
                .filter(w -> w != null)
                .map(w -> workspaceVO(w, current.equals(w.id()), permissionsForWorkspace(principal, w.id())))
                .toList();
    }

    public WorkspaceSummaryVO summary(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        List<DataAssetVO> visibleAssets = dataAssets(current, principal);
        long myDataCount = visibleAssets.stream().filter(DataAssetVO::added).count();
        long pendingCount = requestsFor(current, principal).stream().filter(r -> "pending".equals(r.status())).count();
        return new WorkspaceSummaryVO(
                workspace(principal, current),
                groups.getOrDefault(current, List.of()).size(),
                members.getOrDefault(current, List.of()).size(),
                roles.getOrDefault(current, List.of()).size(),
                visibleAssets.size(),
                (int) myDataCount,
                (int) pendingCount,
                List.of("2 个资产申请待审批", "1 个高敏字段策略需复核", "3 个成员权限继承自用户组")
        );
    }

    public WorkspaceVO workspace(AuthPrincipal principal, String workspaceId) {
        String current = visibleWorkspaceId(principal, workspaceId);
        return workspaceVO(workspaces.get(current), true, permissionsForWorkspace(principal, current));
    }

    public List<WorkspaceGroupVO> groups(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        return groups.getOrDefault(current, List.of()).stream()
                .map(g -> new WorkspaceGroupVO(g.id(), g.name(), g.description(), g.memberCount(), g.roles()))
                .toList();
    }

    public List<WorkspaceMemberVO> members(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        List<IdentityRepository.MemberRow> live = identityRepository.listMembers(current);
        if (!live.isEmpty()) {
            return live.stream()
                    .map(m -> new WorkspaceMemberVO(
                            m.userId(),
                            m.displayName(),
                            m.status() == null ? "active" : m.status(),
                            List.of(),
                            List.of(roleLabel(m.roleCode()))
                    ))
                    .toList();
        }
        return members.getOrDefault(current, List.of()).stream()
                .map(m -> new WorkspaceMemberVO(m.userId(), m.displayName(), m.status(), m.groups(), m.roles()))
                .toList();
    }

    public List<WorkspaceRoleVO> roles(String workspaceId, AuthPrincipal principal) {
        visibleWorkspaceId(principal, workspaceId);
        return rolesForPrincipal(workspaceId, principal);
    }

    public EffectivePermissionVO effectivePermissions(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        LinkedHashSet<String> permissions = new LinkedHashSet<>(permissionsForWorkspace(principal, current));
        return new EffectivePermissionVO(
                current,
                principal.userId(),
                sorted(permissions),
                grantedAskableSources(principal)
        );
    }

    /**
     * Askable sources from resource ACL (plaza is a view, not the grant source).
     */
    public List<String> grantedAskableSources(AuthPrincipal principal) {
        EffectiveAccessService acl = access.getIfAvailable();
        if (acl != null) {
            return List.copyOf(acl.grantedDatasetIds(principal));
        }
        return List.of();
    }

    public DataPlazaVO dataPlaza(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        List<DataAssetVO> visible = dataAssets(current, principal);
        return new DataPlazaVO(
                workspace(principal, current),
                workspaces(principal, current).stream()
                        .map(w -> new DataSpaceVO(w.id(), w.name(), w.assetCount(), true))
                        .toList(),
                visible,
                visible.stream().filter(DataAssetVO::added).toList(),
                requestsFor(current, principal)
        );
    }

    public DataAssetVO addToMyData(String workspaceId, String assetId, AuthPrincipal principal) {
        visibleWorkspaceId(principal, workspaceId);
        Set<String> pending = pendingDatasetIds(workspaceId, principal);
        DataAssetVO view = resolveAsset(assetId, workspaceId, principal, pending);
        if (!view.actions().contains("add")) {
            throw new ForbiddenException("资产未授权消费，不能加入我的数据");
        }
        addedAssets.add(addKey(principal, assetId));
        return resolveAsset(assetId, workspaceId, principal, pending);
    }

    public DataRequestVO requestAccess(String workspaceId, DataRequestCreateRequest body, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        if (body == null || body.assetId() == null || body.assetId().isBlank()) {
            throw new IllegalArgumentException("assetId required");
        }
        DataAssetVO view = resolveAsset(body.assetId(), current, principal, pendingDatasetIds(current, principal));
        if (!view.actions().contains("request")) {
            throw new ForbiddenException("该资产当前无需申请或不可申请");
        }
        List<String> requested = body.requestedActions() == null || body.requestedActions().isEmpty()
                ? ("dashboard".equals(view.type()) ? List.of("view") : List.of("consume"))
                : List.copyOf(body.requestedActions());
        String key = requestKey(principal, view.id());
        DatasetPermissionService perms = permissions.getIfAvailable();
        String persistedId = perms == null ? null : perms.recordRequest(
                current,
                view.id(),
                body.purpose() == null || body.purpose().isBlank() ? "用于业务分析" : body.purpose(),
                requested,
                principal
        );
        return requests.computeIfAbsent(key, ignored -> new DataRequestVO(
                persistedId == null ? "req-" + UUID.randomUUID().toString().substring(0, 8) : persistedId,
                view.id(),
                view.name(),
                current,
                "pending",
                "数据负责人",
                Instant.now().toEpochMilli(),
                body.purpose() == null || body.purpose().isBlank() ? "用于业务分析" : body.purpose(),
                requested
        ));
    }

    private List<WorkspaceRoleVO> rolesForPrincipal(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        return roleSeeds(current).stream()
                .map(r -> new WorkspaceRoleVO(r.code(), r.name(), r.description(), r.permissions()))
                .toList();
    }

    private List<DataRequestVO> requestsFor(String workspaceId, AuthPrincipal principal) {
        Map<String, DataRequestVO> byAsset = new LinkedHashMap<>();
        ResourceAccessPort port = resourceAccess.getIfAvailable();
        if (port != null) {
            try {
                for (DatasetRequest row : port.listRequests(workspaceId)) {
                    if (!principal.userId().equals(row.applicantId()) || !"pending".equals(row.status())) {
                        continue;
                    }
                    DatasetMetaVO meta = findDatasetOrNull(row.datasetId());
                    String assetName = meta == null ? null : meta.name();
                    if (assetName == null) {
                        DashboardAppService dashSvc = dashboards.getIfAvailable();
                        assetName = dashSvc == null
                                ? row.datasetId()
                                : dashSvc.findNodeMeta(row.datasetId()).map(DashboardNodeVO::name).orElse(row.datasetId());
                    }
                    byAsset.put(row.datasetId(), new DataRequestVO(
                            row.id(),
                            row.datasetId(),
                            assetName,
                            workspaceId,
                            "pending",
                            "数据负责人",
                            row.createdAt(),
                            row.purpose(),
                            row.requestedActions() == null || row.requestedActions().isBlank()
                                    ? List.of("use")
                                    : List.of(row.requestedActions().split(","))
                    ));
                }
            } catch (RuntimeException ignored) {
                // ACL 表未就绪时回落到进程内申请
            }
        }
        String prefix = principal.userId() + ":";
        requests.entrySet().stream()
                .filter(entry -> entry.getKey().startsWith(prefix))
                .forEach(entry -> byAsset.putIfAbsent(entry.getValue().assetId(), entry.getValue()));
        return byAsset.values().stream()
                .sorted(Comparator.comparingLong(DataRequestVO::createdAt).reversed())
                .toList();
    }

    private Set<String> pendingDatasetIds(String workspaceId, AuthPrincipal principal) {
        return requestsFor(workspaceId, principal).stream()
                .filter(r -> "pending".equals(r.status()))
                .map(DataRequestVO::assetId)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    }

    private List<DataAssetVO> dataAssets(String workspaceId, AuthPrincipal principal) {
        visibleWorkspaceId(principal, workspaceId);
        Set<String> pending = pendingDatasetIds(workspaceId, principal);
        List<DataAssetVO> out = new ArrayList<>();
        for (DatasetMetaVO meta : datasets.listCatalog()) {
            out.add(toDatasetAsset(meta, workspaceId, principal, pending));
        }
        DashboardAppService dashSvc = dashboards.getIfAvailable();
        if (dashSvc != null) {
            for (DashboardNodeVO node : dashSvc.listPlazaPublished()) {
                out.add(toDashboardAsset(node, workspaceId, principal, pending));
            }
        }
        out.sort(Comparator.comparing(DataAssetVO::added).reversed()
                .thenComparing(DataAssetVO::updatedAt).reversed());
        return out;
    }

    private DataAssetVO resolveAsset(String assetId, String workspaceId, AuthPrincipal principal, Set<String> pending) {
        DatasetMetaVO meta = findDatasetOrNull(assetId);
        if (meta != null) {
            return toDatasetAsset(meta, workspaceId, principal, pending);
        }
        DashboardAppService dashSvc = dashboards.getIfAvailable();
        DashboardNodeVO node = dashSvc == null ? null : dashSvc.findNodeMeta(assetId).orElse(null);
        if (node != null && "dashboard".equals(node.nodeType())) {
            String status = node.status();
            if (!"published".equals(status) && !"publishedWithDraft".equals(status)) {
                throw new ForbiddenException("仅已发布仪表盘可在数据广场申请或添加");
            }
            return toDashboardAsset(node, workspaceId, principal, pending);
        }
        throw new IllegalArgumentException("asset not found: " + assetId);
    }

    private DataAssetVO toDatasetAsset(
            DatasetMetaVO meta,
            String workspaceId,
            AuthPrincipal principal,
            Set<String> pending
    ) {
        boolean requested = pending.contains(meta.id());
        boolean added = addedAssets.contains(addKey(principal, meta.id()));
        EffectiveAccessService acl = access.getIfAvailable();
        boolean granted = acl != null && acl.canUseDataset(principal, meta.id());
        String status = granted ? "granted" : (requested ? "pending" : "requestable");
        List<String> actions = datasetActions(status, added);
        WorkspaceSeed workspace = workspaces.get(workspaceId);
        String folder = meta.folder() == null ? "" : meta.folder().trim();
        String description = granted
                ? (folder.isEmpty() ? "已授权数据集" : folder)
                : (folder.isEmpty() ? "已发布数据集，可申请消费。" : folder + " · 已发布，可申请消费。");
        return new DataAssetVO(
                meta.id(),
                meta.name(),
                "dataset",
                workspaceId,
                workspace == null ? workspaceId : workspace.name(),
                "管理员",
                description,
                granted ? meta.id() : "",
                "low",
                status,
                added,
                folder.isEmpty() ? List.of() : List.of(folder),
                meta.updateTime() == null ? 0L : meta.updateTime(),
                actions,
                null
        );
    }

    private DataAssetVO toDashboardAsset(
            DashboardNodeVO node,
            String workspaceId,
            AuthPrincipal principal,
            Set<String> pending
    ) {
        boolean requested = pending.contains(node.id());
        boolean added = addedAssets.contains(addKey(principal, node.id()));
        EffectiveAccessService acl = access.getIfAvailable();
        boolean granted = acl != null && acl.canViewDashboard(principal, node.id());
        String status = granted ? "granted" : (requested ? "pending" : "requestable");
        List<String> actions = dashboardActions(status, added);
        WorkspaceSeed workspace = workspaces.get(workspaceId);
        String publishLabel = "publishedWithDraft".equals(node.status()) ? "有未发布改动" : "已发布";
        String description = granted
                ? "已授权仪表盘 · " + publishLabel
                : "已发布仪表盘，可申请查看。";
        return new DataAssetVO(
                node.id(),
                node.name(),
                "dashboard",
                workspaceId,
                workspace == null ? workspaceId : workspace.name(),
                "管理员",
                description,
                granted ? node.id() : "",
                "low",
                status,
                added,
                List.of(publishLabel),
                node.updateTime() == null ? 0L : node.updateTime(),
                actions,
                node.status()
        );
    }

    private List<String> datasetActions(String status, boolean added) {
        List<String> actions = new ArrayList<>();
        if ("granted".equals(status)) {
            actions.add("ask");
            if (!added) actions.add("add");
        } else if ("requestable".equals(status) || "pending".equals(status)) {
            actions.add("request");
        }
        return List.copyOf(actions);
    }

    private List<String> dashboardActions(String status, boolean added) {
        List<String> actions = new ArrayList<>();
        if ("granted".equals(status)) {
            actions.add("open");
            if (!added) actions.add("add");
        } else if ("requestable".equals(status) || "pending".equals(status)) {
            actions.add("request");
        }
        return List.copyOf(actions);
    }

    private DatasetMetaVO findDataset(String assetId) {
        DatasetMetaVO meta = findDatasetOrNull(assetId);
        if (meta == null) {
            throw new IllegalArgumentException("asset not found: " + assetId);
        }
        return meta;
    }

    private DatasetMetaVO findDatasetOrNull(String assetId) {
        return datasets.listCatalog().stream()
                .filter(d -> d.id().equals(assetId))
                .findFirst()
                .orElse(null);
    }

    private String visibleWorkspaceId(AuthPrincipal principal, String workspaceId) {
        String id = workspaceId == null || workspaceId.isBlank() ? principal.workspaceId() : workspaceId;
        if (!workspaces.containsKey(id) || !visibleWorkspaceIds(principal).contains(id)) {
            throw new ForbiddenException("工作区不可见: " + id);
        }
        return id;
    }

    private List<String> visibleWorkspaceIds(AuthPrincipal principal) {
        if (isPlatformAdmin(principal)) {
            return List.copyOf(workspaces.keySet());
        }
        List<String> ids = identityRepository.workspacesForUser(principal.userId());
        if (ids.isEmpty()) ids = List.of(principal.workspaceId());
        return ids.stream()
                .filter(workspaces::containsKey)
                .distinct()
                .toList();
    }

    private boolean isPlatformAdmin(AuthPrincipal principal) {
        Set<String> permissions = principal.permissions();
        return permissions.contains("*") || permissions.contains("platform:admin");
    }

    private Set<String> permissionsForWorkspace(AuthPrincipal principal, String workspaceId) {
        List<String> permissions = identityRepository.permissionsForUser(principal.userId(), workspaceId);
        if (workspaceId.equals(principal.workspaceId()) && permissions.isEmpty()) {
            return principal.permissions();
        }
        return new LinkedHashSet<>(permissions);
    }

    private WorkspaceVO workspaceVO(WorkspaceSeed seed, boolean current, Set<String> permissions) {
        int assetCount = datasets.listCatalog().size();
        return new WorkspaceVO(seed.id(), seed.name(), seed.description(), seed.mode(), roleFromPermissions(permissions), current,
                seed.memberCount(), assetCount);
    }

    private String roleFromPermissions(Set<String> permissions) {
        if (permissions.contains("*") || permissions.contains("platform:admin")) {
            return "platform-admin";
        }
        if (permissions.contains("workspace:admin") || permissions.contains("workspace:manage_member")) {
            return "workspace-admin";
        }
        if (permissions.contains("dashboard:manage") || permissions.contains("report:manage") || permissions.contains("conversation:use")) {
            return "analyst";
        }
        return "viewer";
    }

    private List<RoleSeed> roleSeeds(String workspaceId) {
        return roles.getOrDefault(workspaceId, roles.getOrDefault(AuthPrincipal.DEFAULT_WORKSPACE_ID, List.of()));
    }

    private static String roleLabel(String code) {
        if ("platform_admin".equals(code) || "platform-admin".equals(code)) return "平台管理员";
        if ("workspace_admin".equals(code) || "workspace-admin".equals(code)) return "工作区管理员";
        if ("analyst".equals(code)) return "分析师";
        if ("viewer".equals(code)) return "浏览者";
        return code == null ? "" : code;
    }

    private static List<String> sorted(Set<String> values) {
        return values.stream().sorted().toList();
    }

    private static String addKey(AuthPrincipal principal, String assetId) {
        return principal.userId() + ":" + assetId;
    }

    private static String requestKey(AuthPrincipal principal, String assetId) {
        return principal.userId() + ":" + assetId;
    }

    private void seedWorkspaces() {
        workspaces.put("workspace-retail", new WorkspaceSeed("workspace-retail", "零售经营项目组",
                "门店、订单、会员和经营指标分析", "team", "workspace-admin", 18));
        workspaces.put("workspace-east", new WorkspaceSeed("workspace-east", "华东门店项目组",
                "区域门店经营分析和分店授权", "team", "analyst", 8));
        workspaces.put("workspace-finance", new WorkspaceSeed("workspace-finance", "财务共享空间",
                "支付、退款、结算和财务对账资产", "shared", "viewer", 12));
    }

    private void seedSecurity() {
        List<RoleSeed> defaultRoles = List.of(
                new RoleSeed("platform-admin", "超级管理员", "管理全部工作区、成员、数据和知识发布",
                        List.of("platform:admin", "workspace:admin", "workspace:manage_member", "dataset:manage", "dataset:use", "conversation:use")),
                new RoleSeed("workspace-admin", "工作区管理员", "管理本工作区成员、用户组、角色和资产发布范围",
                        List.of("workspace:admin", "workspace:manage_member", "dataset:manage", "dataset:use", "conversation:use")),
                new RoleSeed("analyst", "分析师", "可消费授权资产并创建对话、看板和报告",
                        List.of("dataset:use", "conversation:use", "dashboard:manage", "report:manage")),
                new RoleSeed("viewer", "浏览者", "查看已授权资产、看板和报告",
                        List.of("dataset:use", "dashboard:view", "report:view"))
        );
        workspaces.keySet().forEach(id -> roles.put(id, defaultRoles));

        groups.put("workspace-retail", List.of(
                new GroupSeed("grp-retail-ops", "经营分析组", "默认进入问数与看板生成流程", 8, List.of("analyst")),
                new GroupSeed("grp-retail-admin", "数据管理员组", "维护数据集、字段语义、行列权限和发布范围", 3, List.of("workspace-admin")),
                new GroupSeed("grp-retail-viewer", "门店浏览组", "只消费已授权看板和报告", 7, List.of("viewer"))
        ));
        groups.put("workspace-east", List.of(
                new GroupSeed("grp-east-ops", "华东运营组", "负责华东门店经营追踪", 5, List.of("analyst")),
                new GroupSeed("grp-east-viewer", "门店店长组", "按门店行权限查看已授权资产", 3, List.of("viewer"))
        ));
        groups.put("workspace-finance", List.of(
                new GroupSeed("grp-finance", "财务分析组", "结算、退款和账期分析", 6, List.of("viewer")),
                new GroupSeed("grp-finance-admin", "财务数据管理员", "维护高敏字段策略和审批", 2, List.of("workspace-admin"))
        ));

        members.put("workspace-retail", List.of(
                new MemberSeed("demo", "演示用户", "active", List.of("经营分析组"), List.of("分析师")),
                new MemberSeed("lin", "林数据", "active", List.of("数据管理员组"), List.of("工作区管理员")),
                new MemberSeed("wang", "王业务", "active", List.of("经营分析组"), List.of("分析师")),
                new MemberSeed("chen", "陈治理", "invited", List.of("门店浏览组"), List.of("浏览者"))
        ));
        members.put("workspace-east", List.of(
                new MemberSeed("demo", "演示用户", "active", List.of("华东运营组"), List.of("分析师")),
                new MemberSeed("chen", "陈治理", "active", List.of("门店店长组"), List.of("浏览者"))
        ));
        members.put("workspace-finance", List.of(
                new MemberSeed("demo", "演示用户", "active", List.of("财务分析组"), List.of("浏览者")),
                new MemberSeed("lin", "林数据", "active", List.of("财务数据管理员"), List.of("工作区管理员"))
        ));
    }

    private record WorkspaceSeed(String id, String name, String description, String mode, String role, int memberCount) {}

    private record GroupSeed(String id, String name, String description, int memberCount, List<String> roles) {}

    private record RoleSeed(String code, String name, String description, List<String> permissions) {}

    private record MemberSeed(String userId, String displayName, String status, List<String> groups, List<String> roles) {}

    public record AuthMeVO(
            String userId,
            String displayName,
            List<String> permissions,
            String workspaceId,
            WorkspaceVO currentWorkspace,
            List<WorkspaceVO> workspaces,
            List<WorkspaceGroupVO> groups,
            List<WorkspaceRoleVO> roles,
            List<String> effectivePermissions
    ) {}

    public record WorkspaceVO(
            String id,
            String name,
            String description,
            String mode,
            String role,
            boolean current,
            int memberCount,
            int assetCount
    ) {}

    public record WorkspaceSummaryVO(
            WorkspaceVO workspace,
            int groupCount,
            int memberCount,
            int roleCount,
            int assetCount,
            int myDataCount,
            int pendingRequestCount,
            List<String> adminTasks
    ) {}

    public record WorkspaceGroupVO(String id, String name, String description, int memberCount, List<String> roles) {}

    public record WorkspaceRoleVO(String code, String name, String description, List<String> permissions) {}

    public record WorkspaceMemberVO(String userId, String displayName, String status, List<String> groups, List<String> roles) {}

    public record EffectivePermissionVO(String workspaceId, String userId, List<String> permissions, List<String> datasetScopes) {}

    public record DataPlazaVO(
            WorkspaceVO currentWorkspace,
            List<DataSpaceVO> spaces,
            List<DataAssetVO> assets,
            List<DataAssetVO> myData,
            List<DataRequestVO> requests
    ) {}

    public record DataSpaceVO(String id, String name, int assetCount, boolean joined) {}

    public record DataAssetVO(
            String id,
            String name,
            String type,
            String workspaceId,
            String workspaceName,
            String owner,
            String description,
            String source,
            String sensitiveLevel,
            String authStatus,
            boolean added,
            List<String> tags,
            long updatedAt,
            List<String> actions,
            String publishStatus
    ) {}

    public record DataRequestCreateRequest(
            String assetId,
            String purpose,
            Integer expireDays,
            List<String> requestedActions
    ) {}

    public record DataRequestVO(
            String id,
            String assetId,
            String assetName,
            String workspaceId,
            String status,
            String approver,
            long createdAt,
            String purpose,
            List<String> requestedActions
    ) {}
}
