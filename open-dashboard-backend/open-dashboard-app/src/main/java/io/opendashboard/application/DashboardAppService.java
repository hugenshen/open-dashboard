package io.opendashboard.application;

import io.opendashboard.domain.DashboardDtos.BusiNodeVO;
import io.opendashboard.domain.DashboardDtos.ChartViewSaveRequest;
import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardBarVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentsUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardCreateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutVO;
import io.opendashboard.domain.DashboardDtos.DashboardLinkageVO;
import io.opendashboard.domain.DashboardDtos.DashboardMoveRequest;
import io.opendashboard.domain.DashboardDtos.DashboardNodeVO;
import io.opendashboard.domain.DashboardDtos.DashboardRenameRequest;
import io.opendashboard.domain.DashboardDtos.DashboardShareVO;
import io.opendashboard.domain.DashboardDtos.DashboardStatusVO;
import io.opendashboard.domain.DashboardDtos.DashboardTemplateVO;
import io.opendashboard.domain.DashboardDtos.ShareViewVO;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.gateway.DashboardGateway;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class DashboardAppService {

    private final ObjectProvider<DashboardGateway> repository;
    private final ObjectProvider<DatasetService> datasetService;
    private final ObjectProvider<DatasetPermissionService> permissions;
    private final ObjectProvider<EffectiveAccessService> access;
    private final ConcurrentHashMap<String, MemDash> mem = new ConcurrentHashMap<>();
    private final AtomicLong seq = new AtomicLong(2000);
    private final AtomicLong tplSeq = new AtomicLong(System.currentTimeMillis());

    public DashboardAppService(
            ObjectProvider<DashboardGateway> repository,
            ObjectProvider<DatasetService> datasetService,
            ObjectProvider<DatasetPermissionService> permissions,
            ObjectProvider<EffectiveAccessService> access
    ) {
        this.repository = repository;
        this.datasetService = datasetService;
        this.permissions = permissions;
        this.access = access;
        seed();
    }

    /** Published dashboards for data-plaza discovery (no ACL filter). */
    public List<DashboardNodeVO> listPlazaPublished() {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            return repo.listPlazaPublished();
        }
        List<DashboardNodeVO> out = new ArrayList<>();
        for (MemDash d : mem.values()) {
            if (!"dashboard".equals(d.meta.nodeType())) continue;
            String status = d.meta.status();
            if ("published".equals(status) || "publishedWithDraft".equals(status)) {
                out.add(d.meta);
            }
        }
        out.sort(Comparator
                .comparing((DashboardNodeVO n) -> n.updateTime() == null ? 0L : n.updateTime())
                .reversed());
        return out;
    }

    public Optional<DashboardNodeVO> findNodeMeta(String id) {
        if (id == null || id.isBlank()) return Optional.empty();
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.findDetail(Long.parseLong(id), "draft").map(DashboardDetailVO::meta);
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        return d == null ? Optional.empty() : Optional.of(d.meta);
    }

    public List<DashboardTemplateVO> listTemplates() {
        return DashboardTemplateCatalog.list();
    }

    private void seed() {
        Map<String, ChartViewVO> charts = new HashMap<>();
        charts.put("101", new ChartViewVO("101", "1", "ds_sales", "bar", "区域销售额",
                Map.of("datasetId", "ds_sales", "category", "region", "value", "amount", "agg", "SUM"),
                Map.of(), Map.of()));
        charts.put("102", new ChartViewVO("102", "1", "ds_sales", "kpi", "总金额 KPI",
                Map.of("datasetId", "ds_sales", "value", "amount", "agg", "SUM"),
                Map.of(), Map.of()));
        charts.put("103", new ChartViewVO("103", "1", "ds_sales", "line", "渠道趋势",
                Map.of("datasetId", "ds_sales", "category", "channel", "value", "amount", "agg", "SUM"),
                Map.of(), Map.of()));
        // 72-col sizes chosen so hi-fi (÷6) gets bar 6×5 / kpi 4×2 / line 12×4
        List<DashboardComponentVO> comps = List.of(
                new DashboardComponentVO("1001", "chart", "0", "101", 0, 0, 36, 30, 1, Map.of()),
                new DashboardComponentVO("1002", "chart", "0", "102", 36, 0, 24, 12, 2, Map.of()),
                new DashboardComponentVO("1003", "chart", "0", "103", 0, 30, 72, 24, 3, Map.of())
        );
        MemDash d = new MemDash(
                new DashboardNodeVO("1", "0", "销售周报（脚手架）", "dashboard", "draft", "grid", "1", 1, 0L),
                new DashboardLayoutVO(72, 36, null, 0, Map.of(),
                        Map.of("enabled", true, "device", "iphone-14", "bg", "#f5f6f8", "components", List.of())),
                new ArrayList<>(comps),
                new HashMap<>(charts),
                null,
                null
        );
        d.createBy = "system";
        d.updateBy = "system";
        mem.put("1", d);
    }

    public Optional<DashboardDetailVO> get(String id, String view) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.findDetail(Long.parseLong(id), view == null ? "draft" : view);
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        boolean published = "published".equals(view);
        if (published && "draft".equals(d.meta.status())) return Optional.empty();
        if (published && d.publishedLayout != null) {
            return Optional.of(new DashboardDetailVO(
                    d.meta, d.publishedLayout, d.publishedComponents, d.publishedCharts, d.publishedLinkages
            ));
        }
        return Optional.of(new DashboardDetailVO(d.meta, d.layout, d.components, d.charts, d.linkages));
    }

    public List<BusiNodeVO> tree() {
        DashboardGateway repo = repository.getIfAvailable();
        List<BusiNodeVO> raw;
        if (repo != null) {
            raw = repo.tree();
        } else {
            List<BusiNodeVO> roots = new ArrayList<>();
            for (MemDash d : mem.values()) {
                if (!"0".equals(d.meta.pid())) continue;
                roots.add(new BusiNodeVO(
                        d.meta.id(), d.meta.pid(), d.meta.name(), d.meta.nodeType(),
                        "dashboard".equals(d.meta.nodeType()), List.of()
                ));
            }
            raw = roots;
        }
        return filterTree(raw);
    }

    private List<BusiNodeVO> filterTree(List<BusiNodeVO> nodes) {
        AuthPrincipal principal = AuthContext.get();
        EffectiveAccessService acl = access.getIfAvailable();
        if (acl == null) return nodes;
        if (principal == null) return List.of();
        if (EffectiveAccessService.isWorkspaceAdmin(principal) || principal.hasPermission("dashboard:manage")) {
            return nodes;
        }
        Set<String> allowed = acl.grantedDashboardIds(principal);
        return filterTree(nodes, allowed);
    }

    private static List<BusiNodeVO> filterTree(List<BusiNodeVO> nodes, Set<String> allowed) {
        List<BusiNodeVO> out = new ArrayList<>();
        for (BusiNodeVO n : nodes) {
            if ("dashboard".equals(n.nodeType())) {
                if (allowed.contains(n.id())) out.add(n);
                continue;
            }
            List<BusiNodeVO> kids = filterTree(n.children() == null ? List.of() : n.children(), allowed);
            if (!kids.isEmpty()) {
                out.add(new BusiNodeVO(n.id(), n.pid(), n.name(), n.nodeType(), n.leaf(), kids));
            }
        }
        return out;
    }

    public DashboardNodeVO create(DashboardCreateRequest req) {
        String templateId = DashboardTemplateCatalog.normalize(req.templateId());
        String name = resolveCreateName(req, templateId);
        DashboardCreateRequest normalized = new DashboardCreateRequest(
                req.pid(), name, req.nodeType(), req.layoutMode(), templateId
        );

        DashboardGateway repo = repository.getIfAvailable();
        DashboardNodeVO meta;
        if (repo != null) {
            meta = repo.create(normalized);
        } else {
            String id = String.valueOf(seq.incrementAndGet());
            long now = System.currentTimeMillis();
            String actor = AuthContext.userIdOr("system");
            meta = new DashboardNodeVO(
                    id,
                    normalized.pid() == null ? "0" : normalized.pid(),
                    name,
                    normalized.nodeType() == null ? "dashboard" : normalized.nodeType(),
                    "draft",
                    normalized.layoutMode() == null ? "grid" : normalized.layoutMode(),
                    "1",
                    1,
                    now
            );
            MemDash d = new MemDash(
                    meta,
                    new DashboardLayoutVO(72, 36, null, 0, Map.of(),
                            Map.of("enabled", false, "device", "iphone-14", "bg", "#f5f6f8", "components", List.of())),
                    new ArrayList<>(),
                    new HashMap<>(),
                    null,
                    null
            );
            d.createBy = actor;
            d.updateBy = actor;
            d.createTime = now;
            mem.put(id, d);
        }
        applyTemplate(meta.id(), templateId);
        DatasetPermissionService acl = permissions.getIfAvailable();
        if (acl != null && (meta.nodeType() == null || "dashboard".equals(meta.nodeType()))) {
            acl.grantOwner("dashboard", meta.id(), AuthContext.get());
        }
        // re-read so contentId/version reflect template writes
        return get(meta.id(), "draft").map(DashboardDetailVO::meta).orElse(meta);
    }

    private static String resolveCreateName(DashboardCreateRequest req, String templateId) {
        if (req.name() != null && !req.name().isBlank()) return req.name().trim();
        String fromTpl = DashboardTemplateCatalog.defaultName(templateId);
        if (fromTpl != null) return fromTpl;
        return "未命名仪表盘";
    }

    private void applyTemplate(String dashboardId, String templateId) {
        DashboardTemplateCatalog.Blueprint bp = DashboardTemplateCatalog.build(
                templateId, dashboardId, tplSeq::incrementAndGet
        );
        if (bp.isEmpty()) return;

        Map<String, Object> mobile = bp.mobile() == null || bp.mobile().isEmpty() ? null : bp.mobile();
        if (!bp.extStyle().isEmpty() || mobile != null) {
            updateLayout(dashboardId, new DashboardLayoutUpdateRequest(
                    72, 120, null, 0, bp.extStyle(), mobile, "1"
            ));
        }
        for (ChartViewVO ch : bp.charts().values()) {
            saveChart(dashboardId, ch.id(), new ChartViewSaveRequest(
                    ch.datasetId(),
                    ch.chartType(),
                    ch.title(),
                    ch.encode(),
                    ch.style(),
                    ch.senior(),
                    "1"
            ));
        }
        updateComponents(dashboardId, new DashboardComponentsUpdateRequest(
                bp.components(), List.of(), "1"
        ));
        if (bp.linkages() != null && !bp.linkages().isEmpty()) {
            putLinkages(dashboardId, bp.linkages());
        }
    }

    public Optional<DashboardNodeVO> rename(DashboardRenameRequest req) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.rename(req);
        MemDash d = mem.get(req.id());
        if (d == null) return Optional.empty();
        d.meta = new DashboardNodeVO(
                d.meta.id(), d.meta.pid(), req.name().trim(), d.meta.nodeType(),
                d.meta.status(), d.meta.layoutMode(), d.meta.contentId(), d.meta.version(),
                System.currentTimeMillis()
        );
        d.updateBy = AuthContext.userIdOr("system");
        return Optional.of(d.meta);
    }

    public Optional<DashboardNodeVO> move(DashboardMoveRequest req) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.move(req);
        MemDash d = mem.get(req.id());
        if (d == null) return Optional.empty();
        d.meta = new DashboardNodeVO(
                d.meta.id(), req.pid(), d.meta.name(), d.meta.nodeType(),
                d.meta.status(), d.meta.layoutMode(), d.meta.contentId(), d.meta.version(),
                System.currentTimeMillis()
        );
        d.updateBy = AuthContext.userIdOr("system");
        return Optional.of(d.meta);
    }

    public boolean delete(String id) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.delete(Long.parseLong(id));
            } catch (NumberFormatException e) {
                return false;
            }
        }
        return mem.remove(id) != null;
    }

    public Optional<DashboardBarVO> barInfo(String id) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.barInfo(Long.parseLong(id));
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        return Optional.of(new DashboardBarVO(
                d.meta.id(), d.meta.name(), d.meta.nodeType(), d.meta.status(),
                d.createBy, d.createTime != null ? d.createTime : d.meta.updateTime(),
                d.updateBy, d.meta.updateTime(), d.charts.size()
        ));
    }

    public Optional<DashboardLayoutVO> updateLayout(String id, DashboardLayoutUpdateRequest req) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.updateLayout(Long.parseLong(id), req);
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        d.layout = new DashboardLayoutVO(
                req.gridCols() == null ? d.layout.gridCols() : req.gridCols(),
                req.gridRows() == null ? d.layout.gridRows() : req.gridRows(),
                req.themeRef() == null ? d.layout.themeRef() : req.themeRef(),
                req.refreshSec() == null ? d.layout.refreshSec() : req.refreshSec(),
                req.extStyle() == null ? d.layout.extStyle() : req.extStyle(),
                req.mobile() == null ? d.layout.mobile() : req.mobile()
        );
        bump(d);
        return Optional.of(d.layout);
    }

    public Optional<List<DashboardComponentVO>> updateComponents(String id, DashboardComponentsUpdateRequest req) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.updateComponents(Long.parseLong(id), req);
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        List<String> deleteIds = req.deleteIds() == null ? List.of() : req.deleteIds();
        d.components.removeIf(c -> deleteIds.contains(c.id()));
        if (req.upsert() != null) {
            for (DashboardComponentVO c : req.upsert()) {
                int idx = -1;
                for (int i = 0; i < d.components.size(); i++) {
                    if (d.components.get(i).id().equals(c.id())) {
                        idx = i;
                        break;
                    }
                }
                if (idx >= 0) d.components.set(idx, c);
                else d.components.add(c);
            }
        }
        bump(d);
        return Optional.of(new ArrayList<>(d.components));
    }

    public Optional<ChartViewVO> saveChart(String dashboardId, String chartId, ChartViewSaveRequest req) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.saveChart(Long.parseLong(dashboardId), parseFlexibleId(chartId), req);
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(dashboardId);
        if (d == null) return Optional.empty();
        Map<String, Object> encode = req.encode() == null ? new HashMap<>() : new HashMap<>(req.encode());
        if (req.datasetId() != null) encode.put("datasetId", req.datasetId());
        ChartViewVO vo = new ChartViewVO(
                chartId, dashboardId, req.datasetId(), req.chartType(), req.title(),
                encode,
                req.style() == null ? Map.of() : req.style(),
                req.senior() == null ? Map.of() : req.senior()
        );
        d.charts.put(chartId, vo);
        bump(d);
        return Optional.of(vo);
    }

    public boolean deleteChart(String dashboardId, String chartId) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.deleteChart(Long.parseLong(dashboardId), Long.parseLong(chartId));
            } catch (NumberFormatException e) {
                return false;
            }
        }
        MemDash d = mem.get(dashboardId);
        if (d == null) return false;
        if (d.charts.remove(chartId) == null) return false;
        bump(d);
        return true;
    }

    public Optional<DashboardStatusVO> publish(String id) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.publish(Long.parseLong(id));
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        d.publishedLayout = d.layout;
        d.publishedComponents = new ArrayList<>(d.components);
        d.publishedCharts = new HashMap<>(d.charts);
        d.publishedLinkages = new ArrayList<>(d.linkages);
        d.meta = new DashboardNodeVO(
                d.meta.id(), d.meta.pid(), d.meta.name(), d.meta.nodeType(),
                "published", d.meta.layoutMode(), d.meta.contentId(),
                d.meta.version() + 1, System.currentTimeMillis()
        );
        return Optional.of(new DashboardStatusVO(d.meta.id(), d.meta.status(), d.meta.contentId(), d.meta.version()));
    }

    public Optional<List<DashboardLinkageVO>> getLinkages(String id, String view) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                String copy = "published".equals(view) ? "published" : "draft";
                return Optional.of(repo.loadLinkages(Long.parseLong(id), copy));
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        return get(id, view == null ? "draft" : view).map(DashboardDetailVO::linkages);
    }

    public Optional<List<DashboardLinkageVO>> putLinkages(String id, List<DashboardLinkageVO> linkages) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.putLinkages(Long.parseLong(id), linkages);
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        d.linkages = linkages == null ? new ArrayList<>() : new ArrayList<>(linkages);
        bump(d);
        return Optional.of(d.linkages);
    }

    public Optional<DashboardStatusVO> discardDraft(String id) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.discardDraft(Long.parseLong(id));
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        if (d.publishedLayout != null) {
            d.layout = d.publishedLayout;
            d.components = new ArrayList<>(d.publishedComponents);
            d.charts = new HashMap<>(d.publishedCharts);
            d.linkages = new ArrayList<>(d.publishedLinkages);
            d.meta = new DashboardNodeVO(
                    d.meta.id(), d.meta.pid(), d.meta.name(), d.meta.nodeType(),
                    "published", d.meta.layoutMode(), d.meta.contentId(), d.meta.version(),
                    System.currentTimeMillis()
            );
        }
        return status(id);
    }

    public Optional<DashboardShareVO> share(String id, Map<String, String> body) {
        DashboardGateway repo = repository.getIfAvailable();
        String visibility = body == null ? null : body.get("visibility");
        String perm = body == null ? null : body.get("perm");
        if (repo != null) {
            try {
                return repo.upsertShare(Long.parseLong(id), visibility, perm);
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        String token = d.share != null && d.share.token() != null
                ? d.share.token()
                : ("tok_" + java.util.UUID.randomUUID().toString().replace("-", ""));
        d.share = new DashboardShareVO(
                d.share == null ? "1" : d.share.id(),
                id,
                token,
                visibility == null ? "public" : visibility,
                perm == null ? "view" : perm,
                true,
                null
        );
        return Optional.of(d.share);
    }

    public Optional<DashboardShareVO> getShare(String id) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.findShare(Long.parseLong(id));
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        return Optional.ofNullable(d.share);
    }

    public Optional<DashboardShareVO> findShareByToken(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            return repo.findShareByToken(token);
        }
        for (MemDash d : mem.values()) {
            if (d.share != null && token.equals(d.share.token())) {
                return Optional.of(d.share);
            }
        }
        return Optional.empty();
    }

    /** 校验 token 并返回已发布仪表盘 + 关联数据集（供公开分享页） */
    public Optional<ShareViewVO> resolveShareView(String token) {
        Optional<DashboardShareVO> shareOpt = findShareByToken(token);
        if (shareOpt.isEmpty()) return Optional.empty();
        DashboardShareVO share = shareOpt.get();
        if (!share.enabled()) return Optional.empty();
        if (share.expireAt() != null && share.expireAt() > 0 && share.expireAt() < System.currentTimeMillis()) {
            return Optional.empty();
        }
        Optional<DashboardDetailVO> detailOpt = get(share.dashboardId(), "published");
        if (detailOpt.isEmpty()) {
            // 尚无 published 副本时回退 draft，便于本地联调
            detailOpt = get(share.dashboardId(), "draft");
        }
        if (detailOpt.isEmpty()) return Optional.empty();
        DashboardDetailVO detail = detailOpt.get();
        List<DatasetDetailVO> datasets = loadDatasetsForDetail(detail);
        return Optional.of(new ShareViewVO(share, detail, datasets));
    }

    private List<DatasetDetailVO> loadDatasetsForDetail(DashboardDetailVO detail) {
        Set<String> ids = new HashSet<>();
        if (detail.charts() != null) {
            for (ChartViewVO c : detail.charts().values()) {
                if (c.datasetId() != null && !c.datasetId().isBlank()) {
                    ids.add(c.datasetId());
                }
            }
        }
        DatasetService ds = datasetService.getIfAvailable();
        if (ds == null || ids.isEmpty()) return List.of();
        List<DatasetDetailVO> out = new ArrayList<>();
        for (String id : ids) {
            ds.get(id).ifPresent(out::add);
        }
        return out;
    }

    public Optional<DashboardStatusVO> status(String id) {
        DashboardGateway repo = repository.getIfAvailable();
        if (repo != null) {
            try {
                return repo.status(Long.parseLong(id));
            } catch (NumberFormatException e) {
                return Optional.empty();
            }
        }
        MemDash d = mem.get(id);
        if (d == null) return Optional.empty();
        return Optional.of(new DashboardStatusVO(d.meta.id(), d.meta.status(), d.meta.contentId(), d.meta.version()));
    }

    /** Non-numeric Agent ids (g1) → 0 so the repository allocates a unique chart view id. */
    static long parseFlexibleId(String raw) {
        if (raw == null || raw.isBlank()) return 0L;
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return 0L;
        }
    }

    private void bump(MemDash d) {
        int content = Integer.parseInt(d.meta.contentId()) + 1;
        d.meta = new DashboardNodeVO(
                d.meta.id(), d.meta.pid(), d.meta.name(), d.meta.nodeType(),
                d.meta.status().equals("published") ? "publishedWithDraft" : d.meta.status(),
                d.meta.layoutMode(), String.valueOf(content), d.meta.version(),
                System.currentTimeMillis()
        );
        d.updateBy = AuthContext.userIdOr("system");
    }

    private static final class MemDash {
        DashboardNodeVO meta;
        DashboardLayoutVO layout;
        List<DashboardComponentVO> components;
        Map<String, ChartViewVO> charts;
        List<DashboardLinkageVO> linkages = new ArrayList<>();
        List<DashboardLinkageVO> publishedLinkages = new ArrayList<>();
        DashboardLayoutVO publishedLayout;
        List<DashboardComponentVO> publishedComponents;
        Map<String, ChartViewVO> publishedCharts;
        DashboardShareVO share;
        String createBy = "system";
        String updateBy = "system";
        Long createTime;

        MemDash(
                DashboardNodeVO meta,
                DashboardLayoutVO layout,
                List<DashboardComponentVO> components,
                Map<String, ChartViewVO> charts,
                DashboardLayoutVO publishedLayout,
                List<DashboardComponentVO> publishedComponents
        ) {
            this.meta = meta;
            this.layout = layout;
            this.components = components;
            this.charts = charts;
            this.publishedLayout = publishedLayout;
            this.publishedComponents = publishedComponents;
            this.publishedCharts = new HashMap<>();
        }
    }
}
