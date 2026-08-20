package io.opendashboard.application;

import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.exception.ForbiddenException;
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
    private final List<AssetSeed> assets = new ArrayList<>();
    private final Set<String> addedAssets = ConcurrentHashMap.newKeySet();
    private final Map<String, DataRequestVO> requests = new ConcurrentHashMap<>();

    public WorkspaceGovernanceService() {
        seedWorkspaces();
        seedSecurity();
        seedAssets();
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
        return workspaces.values().stream()
                .map(w -> workspaceVO(w, current.equals(w.id())))
                .toList();
    }

    public WorkspaceSummaryVO summary(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        List<DataAssetVO> visibleAssets = dataAssets(current, principal);
        long myDataCount = visibleAssets.stream().filter(DataAssetVO::added).count();
        long pendingCount = requestsFor(principal).stream().filter(r -> "pending".equals(r.status())).count();
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
        return workspaceVO(workspaces.get(visibleWorkspaceId(principal, workspaceId)), true);
    }

    public List<WorkspaceGroupVO> groups(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        return groups.getOrDefault(current, List.of()).stream()
                .map(g -> new WorkspaceGroupVO(g.id(), g.name(), g.description(), g.memberCount(), g.roles()))
                .toList();
    }

    public List<WorkspaceMemberVO> members(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
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
        LinkedHashSet<String> permissions = new LinkedHashSet<>(principal.permissions());
        groups.getOrDefault(current, List.of()).forEach(g -> g.roles().forEach(roleCode ->
                roleSeeds(current).stream()
                        .filter(r -> r.code().equals(roleCode))
                        .findFirst()
                        .ifPresent(role -> permissions.addAll(role.permissions()))
        ));
        return new EffectivePermissionVO(
                current,
                principal.userId(),
                sorted(permissions),
                dataAssets(current, principal).stream()
                        .filter(a -> "dataset".equals(a.type()) && (a.added() || "granted".equals(a.authStatus())))
                        .map(DataAssetVO::id)
                        .toList()
        );
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
                requestsFor(principal)
        );
    }

    public DataAssetVO addToMyData(String workspaceId, String assetId, AuthPrincipal principal) {
        visibleWorkspaceId(principal, workspaceId);
        AssetSeed asset = findAsset(assetId);
        DataAssetVO view = toAssetVO(asset, principal);
        if (!view.actions().contains("add")) {
            throw new ForbiddenException("资产未授权消费，不能加入我的数据");
        }
        addedAssets.add(addKey(principal, assetId));
        return toAssetVO(asset, principal);
    }

    public DataRequestVO requestAccess(String workspaceId, DataRequestCreateRequest body, AuthPrincipal principal) {
        visibleWorkspaceId(principal, workspaceId);
        if (body == null || body.assetId() == null || body.assetId().isBlank()) {
            throw new IllegalArgumentException("assetId required");
        }
        AssetSeed asset = findAsset(body.assetId());
        DataAssetVO view = toAssetVO(asset, principal);
        if (!view.actions().contains("request")) {
            throw new ForbiddenException("该资产当前无需申请或不可申请");
        }
        String key = requestKey(principal, asset.id());
        return requests.computeIfAbsent(key, ignored -> new DataRequestVO(
                "req-" + UUID.randomUUID().toString().substring(0, 8),
                asset.id(),
                asset.name(),
                asset.workspaceId(),
                "pending",
                asset.owner(),
                Instant.now().toEpochMilli(),
                body.purpose() == null || body.purpose().isBlank() ? "用于业务分析" : body.purpose(),
                body.requestedActions() == null || body.requestedActions().isEmpty()
                        ? List.of("consume")
                        : List.copyOf(body.requestedActions())
        ));
    }

    private List<WorkspaceRoleVO> rolesForPrincipal(String workspaceId, AuthPrincipal principal) {
        String current = visibleWorkspaceId(principal, workspaceId);
        return roleSeeds(current).stream()
                .map(r -> new WorkspaceRoleVO(r.code(), r.name(), r.description(), r.permissions()))
                .toList();
    }

    private List<DataRequestVO> requestsFor(AuthPrincipal principal) {
        String prefix = principal.userId() + ":";
        return requests.entrySet().stream()
                .filter(entry -> entry.getKey().startsWith(prefix))
                .map(Map.Entry::getValue)
                .sorted(Comparator.comparingLong(DataRequestVO::createdAt).reversed())
                .toList();
    }

    private List<DataAssetVO> dataAssets(String workspaceId, AuthPrincipal principal) {
        visibleWorkspaceId(principal, workspaceId);
        return assets.stream()
                .filter(a -> workspaces.containsKey(a.workspaceId()))
                .map(a -> toAssetVO(a, principal))
                .sorted(Comparator.comparing(DataAssetVO::added).reversed()
                        .thenComparing(DataAssetVO::updatedAt).reversed())
                .toList();
    }

    private DataAssetVO toAssetVO(AssetSeed seed, AuthPrincipal principal) {
        boolean requested = requests.containsKey(requestKey(principal, seed.id()));
        boolean added = seed.addedByDefault() || addedAssets.contains(addKey(principal, seed.id()));
        String status = requested ? "pending" : seed.authStatus();
        List<String> actions = actions(seed, status, added);
        WorkspaceSeed workspace = workspaces.get(seed.workspaceId());
        return new DataAssetVO(
                seed.id(),
                seed.name(),
                seed.type(),
                seed.workspaceId(),
                workspace == null ? seed.workspaceId() : workspace.name(),
                seed.owner(),
                seed.description(),
                seed.source(),
                seed.sensitiveLevel(),
                status,
                added,
                seed.tags(),
                seed.updatedAt(),
                actions
        );
    }

    private List<String> actions(AssetSeed seed, String status, boolean added) {
        List<String> actions = new ArrayList<>();
        if ("granted".equals(status)) {
            if ("dataset".equals(seed.type())) actions.add("ask");
            if ("dashboard".equals(seed.type()) || "combo".equals(seed.type())) actions.add("open");
            if (!added) actions.add("add");
        } else if ("requestable".equals(status)) {
            actions.add("request");
        }
        if ("pending".equals(status)) {
            actions.add("request");
        }
        if ("api".equals(seed.type()) && "granted".equals(status)) {
            actions.add("open");
        }
        return List.copyOf(actions);
    }

    private AssetSeed findAsset(String assetId) {
        return assets.stream()
                .filter(a -> a.id().equals(assetId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("asset not found: " + assetId));
    }

    private String visibleWorkspaceId(AuthPrincipal principal, String workspaceId) {
        String id = workspaceId == null || workspaceId.isBlank() ? principal.workspaceId() : workspaceId;
        if (!workspaces.containsKey(id)) {
            throw new ForbiddenException("工作区不可见: " + id);
        }
        return id;
    }

    private WorkspaceVO workspaceVO(WorkspaceSeed seed, boolean current) {
        long assetCount = assets.stream().filter(a -> seed.id().equals(a.workspaceId())).count();
        return new WorkspaceVO(seed.id(), seed.name(), seed.description(), seed.mode(), seed.role(), current,
                seed.memberCount(), (int) assetCount);
    }

    private List<RoleSeed> roleSeeds(String workspaceId) {
        return roles.getOrDefault(workspaceId, roles.getOrDefault(AuthPrincipal.DEFAULT_WORKSPACE_ID, List.of()));
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
                new RoleSeed("workspace-admin", "工作区管理员", "管理成员、用户组、角色和资产发布范围",
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

    private void seedAssets() {
        long now = Instant.now().toEpochMilli();
        assets.add(new AssetSeed("asset-order", "订单表", "dataset", "workspace-retail", "林数据",
                "t_pay_order · GMV、订单数、渠道、区域，适合经营问数默认上下文。", "ds_order",
                "low", "granted", true, List.of("GMV", "订单", "可问"), now - 10 * 60_000L));
        assets.add(new AssetSeed("asset-weekly", "经营周报仪表板", "dashboard", "workspace-retail", "王业务",
                "零售经营核心指标看板，含 GMV、渠道、区域、客群趋势。", "dash-weekly",
                "low", "granted", true, List.of("看板", "已发布"), now - 3_600_000L));
        assets.add(new AssetSeed("asset-member", "会员画像宽表", "dataset", "workspace-retail", "王业务",
                "dim_member_profile · 会员等级、生命周期、复购标签，含敏感画像字段。", "ds_member",
                "high", "requestable", false, List.of("会员", "高敏需审批"), now - 2 * 3_600_000L));
        assets.add(new AssetSeed("asset-store", "门店日结表", "dataset", "workspace-east", "陈治理",
                "fact_store_daily · 销售额、客单价、门店等级，仅华东区域行权限。", "ds_store_daily",
                "medium", "granted", false, List.of("门店", "行权限"), now - 20 * 60_000L));
        assets.add(new AssetSeed("asset-supply", "供应链库存组合", "combo", "workspace-east", "林数据",
                "库存、采购和调拨三张表的组合资产，管理员已发布到广场。", "combo-supply",
                "medium", "granted", false, List.of("数据表组合", "库存"), now - 4 * 3_600_000L));
        assets.add(new AssetSeed("asset-payment", "支付流水明细", "dataset", "workspace-finance", "王业务",
                "fact_payment_detail · 支付方式、退款、结算状态，昨天提交申请。", "ds_payment",
                "high", "requestable", false, List.of("支付", "高敏需审批"), now - 7 * 3_600_000L));
        assets.add(new AssetSeed("asset-coupon-api", "优惠券核销 API", "api", "workspace-retail", "林数据",
                "按活动读取核销率和客群分布，适合接入运营日报。", "api-coupon",
                "medium", "requestable", false, List.of("API 数据", "运营"), now - 90 * 60_000L));
    }

    private record WorkspaceSeed(String id, String name, String description, String mode, String role, int memberCount) {}

    private record GroupSeed(String id, String name, String description, int memberCount, List<String> roles) {}

    private record RoleSeed(String code, String name, String description, List<String> permissions) {}

    private record MemberSeed(String userId, String displayName, String status, List<String> groups, List<String> roles) {}

    private record AssetSeed(
            String id,
            String name,
            String type,
            String workspaceId,
            String owner,
            String description,
            String source,
            String sensitiveLevel,
            String authStatus,
            boolean addedByDefault,
            List<String> tags,
            long updatedAt
    ) {}

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
            List<String> actions
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
