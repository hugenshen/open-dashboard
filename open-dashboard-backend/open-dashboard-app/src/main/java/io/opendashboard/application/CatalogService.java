package io.opendashboard.application;

import io.opendashboard.domain.CatalogDtos.CatalogBundle;
import io.opendashboard.domain.CatalogDtos.DashboardCatalogItem;
import io.opendashboard.domain.CatalogDtos.DashboardChartCatalogItem;
import io.opendashboard.domain.CatalogDtos.DatasetCatalogItem;
import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.gateway.DashboardGateway;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class CatalogService {

    private final ObjectProvider<DashboardGateway> dashboardRepository;
    private final DatasetService datasetService;
    private final DashboardAppService dashboardAppService;
    private final ObjectProvider<EffectiveAccessService> access;

    public CatalogService(
            ObjectProvider<DashboardGateway> dashboardRepository,
            DatasetService datasetService,
            DashboardAppService dashboardAppService,
            ObjectProvider<EffectiveAccessService> access
    ) {
        this.dashboardRepository = dashboardRepository;
        this.datasetService = datasetService;
        this.dashboardAppService = dashboardAppService;
        this.access = access;
    }

    public CatalogBundle catalog() {
        List<DatasetCatalogItem> datasets = datasetService.catalog();
        DashboardGateway repo = dashboardRepository.getIfAvailable();
        if (repo != null) {
            return new CatalogBundle(visibleDashboards(repo.listDashboardCatalog()), datasets);
        }
        List<DashboardCatalogItem> dashboards = new ArrayList<>();
        for (var node : dashboardAppService.tree()) {
            if (!"dashboard".equals(node.nodeType())) continue;
            DashboardDetailVO detail = dashboardAppService.get(node.id(), "draft").orElse(null);
            if (detail == null || detail.charts().isEmpty()) continue;
            List<DashboardChartCatalogItem> charts = new ArrayList<>();
            for (ChartViewVO c : detail.charts().values()) {
                charts.add(new DashboardChartCatalogItem(c.id(), c.title(), c.chartType(), c.datasetId()));
            }
            dashboards.add(new DashboardCatalogItem(node.id(), node.name(), charts));
        }
        return new CatalogBundle(dashboards, datasets);
    }

    private List<DashboardCatalogItem> visibleDashboards(List<DashboardCatalogItem> all) {
        AuthPrincipal principal = AuthContext.get();
        EffectiveAccessService acl = access.getIfAvailable();
        if (acl == null) return all;
        if (principal == null) return List.of();
        if (EffectiveAccessService.isWorkspaceAdmin(principal) || principal.hasPermission("dashboard:manage")) {
            return all;
        }
        Set<String> allowed = acl.grantedDashboardIds(principal);
        return all.stream().filter(d -> allowed.contains(d.id())).toList();
    }

    public Map<String, Object> resolveChartEncode(String dashboardId, String chartId, String view) {
        DashboardGateway repo = dashboardRepository.getIfAvailable();
        if (repo != null) {
            return repo.findChartEncode(dashboardId, chartId, view == null ? "draft" : view)
                    .orElse(Map.of());
        }
        return dashboardAppService.get(dashboardId, view == null ? "draft" : view)
                .map(d -> {
                    ChartViewVO c = d.charts().get(chartId);
                    if (c == null) return Map.<String, Object>of();
                    Map<String, Object> out = new java.util.HashMap<>(c.encode() == null ? Map.of() : c.encode());
                    out.put("chartType", c.chartType());
                    out.put("title", c.title());
                    out.put("encode", c.encode());
                    out.put("datasetId", c.datasetId());
                    return out;
                })
                .orElse(Map.of());
    }
}
