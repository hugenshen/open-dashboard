package io.opendashboard.application.conversation;

import io.opendashboard.application.DashboardAppService;
import io.opendashboard.domain.ConversationDtos.StylePresetVO;
import io.opendashboard.domain.DashboardDtos.ChartViewSaveRequest;
import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentsUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardCreateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardNodeVO;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class DashboardPatchApplier {

    private final DashboardAppService dashboards;

    public DashboardPatchApplier(DashboardAppService dashboards) {
        this.dashboards = dashboards;
    }

    public record ApplyResult(
            String dashboardId,
            List<String> chartIds,
            Map<String, Object> snapshot
    ) {}

    public ApplyResult apply(String preferredDashboardId, String title, DashboardPatch.Patch patch) {
        String dashboardId = resolveDashboardId(preferredDashboardId, patch.dashboardId(), title);
        List<String> chartIds = new ArrayList<>();
        List<DashboardComponentVO> components = new ArrayList<>();
        Integer gridCols = null;
        String themeRef = null;
        Map<String, Object> extStyle = new HashMap<>();

        for (Map<String, Object> op : patch.ops()) {
            String kind = str(op.get("op"));
            switch (kind) {
                case "set_layout" -> {
                    if (op.get("gridCols") instanceof Number n) gridCols = n.intValue();
                    if (op.get("themeRef") != null) themeRef = str(op.get("themeRef"));
                }
                case "set_theme" -> {
                    String styleId = str(op.get("styleId"));
                    StylePresetVO style = ConversationStyleCatalog.get(styleId);
                    extStyle.put("conversationStyleId", style.id());
                    extStyle.putAll(style.tokens());
                    if (style.tokens().get("theme") != null) {
                        themeRef = String.valueOf(style.tokens().get("theme"));
                    }
                }
                case "upsert_chart" -> {
                    String chartId = str(op.get("chartId"));
                    if (chartId.isBlank()) continue;
                    String datasetId = str(op.get("datasetId"));
                    String type = str(op.get("type"));
                    if (type.isBlank()) type = "bar";
                    String chartTitle = str(op.get("title"));
                    @SuppressWarnings("unchecked")
                    Map<String, Object> encode = op.get("encode") instanceof Map<?, ?> m
                            ? castMap(m) : new HashMap<>();
                    @SuppressWarnings("unchecked")
                    Map<String, Object> style = op.get("style") instanceof Map<?, ?> m
                            ? castMap(m) : Map.of();
                    ChartViewSaveRequest req = new ChartViewSaveRequest(
                            datasetId, type, chartTitle, encode, style, Map.of(), null
                    );
                    Optional<ChartViewVO> saved = dashboards.saveChart(dashboardId, chartId, req);
                    if (saved.isPresent()) chartIds.add(chartId);
                }
                case "upsert_component" -> {
                    String id = str(op.get("id"));
                    String chartId = str(op.get("chartId"));
                    int x = intVal(op.get("x"), 0);
                    int y = intVal(op.get("y"), 0);
                    int w = intVal(op.get("w"), 24);
                    int h = intVal(op.get("h"), 12);
                    components.add(new DashboardComponentVO(
                            id.isBlank() ? "c_" + chartId : id,
                            "chart",
                            null,
                            chartId,
                            x, y, w, h,
                            1,
                            Map.of()
                    ));
                }
                default -> { /* ignore unknown */ }
            }
        }

        dashboards.updateLayout(dashboardId, new DashboardLayoutUpdateRequest(
                gridCols == null ? 72 : gridCols,
                40,
                themeRef == null ? "default" : themeRef,
                null,
                extStyle.isEmpty() ? null : extStyle,
                null,
                null
        ));
        if (!components.isEmpty()) {
            dashboards.updateComponents(dashboardId, new DashboardComponentsUpdateRequest(
                    components, List.of(), null
            ));
        }

        Map<String, Object> snapshot = snapshotOf(dashboardId);
        return new ApplyResult(dashboardId, chartIds, snapshot);
    }

    public void restoreSnapshot(String dashboardId, Map<String, Object> snapshot) {
        if (snapshot == null || snapshot.isEmpty()) return;
        Object layoutObj = snapshot.get("layout");
        if (layoutObj instanceof Map<?, ?> layout) {
            Map<String, Object> l = castMap(layout);
            dashboards.updateLayout(dashboardId, new DashboardLayoutUpdateRequest(
                    intVal(l.get("gridCols"), 72),
                    intVal(l.get("gridRows"), 40),
                    str(l.get("themeRef")),
                    null,
                    l.get("extStyle") instanceof Map<?, ?> e ? castMap(e) : null,
                    l.get("mobile") instanceof Map<?, ?> m ? castMap(m) : null,
                    null
            ));
        }
        Object compsObj = snapshot.get("components");
        if (compsObj instanceof List<?> list) {
            List<DashboardComponentVO> comps = new ArrayList<>();
            for (Object o : list) {
                if (!(o instanceof Map<?, ?> m)) continue;
                Map<String, Object> c = castMap(m);
                comps.add(new DashboardComponentVO(
                        str(c.get("id")),
                        str(c.getOrDefault("type", "chart")),
                        c.get("parentId") == null ? null : str(c.get("parentId")),
                        c.get("chartViewId") == null ? str(c.get("chartId")) : str(c.get("chartViewId")),
                        intVal(c.get("x"), 0),
                        intVal(c.get("y"), 0),
                        intVal(c.get("w"), 24),
                        intVal(c.get("h"), 12),
                        intVal(c.get("zIndex"), 1),
                        c.get("props") instanceof Map<?, ?> p ? castMap(p) : Map.of()
                ));
            }
            dashboards.updateComponents(dashboardId, new DashboardComponentsUpdateRequest(comps, List.of(), null));
        }
        Object chartsObj = snapshot.get("charts");
        if (chartsObj instanceof Map<?, ?> charts) {
            charts.forEach((k, v) -> {
                if (!(v instanceof Map<?, ?> m)) return;
                Map<String, Object> ch = castMap(m);
                dashboards.saveChart(dashboardId, String.valueOf(k), new ChartViewSaveRequest(
                        str(ch.get("datasetId")),
                        str(ch.get("chartType")),
                        str(ch.get("title")),
                        ch.get("encode") instanceof Map<?, ?> e ? castMap(e) : Map.of(),
                        ch.get("style") instanceof Map<?, ?> s ? castMap(s) : Map.of(),
                        ch.get("senior") instanceof Map<?, ?> s ? castMap(s) : Map.of(),
                        null
                ));
            });
        }
    }

    private String resolveDashboardId(String preferred, String patchDash, String title) {
        if (preferred != null && !preferred.isBlank() && dashboards.get(preferred, "draft").isPresent()) {
            return preferred;
        }
        if (patchDash != null && !patchDash.isBlank() && dashboards.get(patchDash, "draft").isPresent()) {
            return patchDash;
        }
        String name = (title == null || title.isBlank()) ? "对话生成看板" : truncate(title, 64);
        DashboardNodeVO created = dashboards.create(new DashboardCreateRequest(
                "0", name, "dashboard", "pc", null
        ));
        return created.id();
    }

    private Map<String, Object> snapshotOf(String dashboardId) {
        Optional<DashboardDetailVO> detail = dashboards.get(dashboardId, "draft");
        Map<String, Object> snap = new LinkedHashMap<>();
        if (detail.isEmpty()) {
            snap.put("dashboardId", dashboardId);
            return snap;
        }
        DashboardDetailVO d = detail.get();
        snap.put("dashboardId", dashboardId);
        snap.put("meta", Map.of(
                "id", d.meta().id(),
                "name", d.meta().name(),
                "status", d.meta().status()
        ));
        snap.put("layout", Map.of(
                "gridCols", d.layout().gridCols(),
                "gridRows", d.layout().gridRows(),
                "themeRef", d.layout().themeRef() == null ? "default" : d.layout().themeRef(),
                "extStyle", d.layout().extStyle() == null ? Map.of() : d.layout().extStyle(),
                "mobile", d.layout().mobile() == null ? Map.of() : d.layout().mobile()
        ));
        List<Map<String, Object>> comps = new ArrayList<>();
        for (DashboardComponentVO c : d.components()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", c.id());
            row.put("type", c.type());
            row.put("chartViewId", c.chartViewId());
            row.put("x", c.x());
            row.put("y", c.y());
            row.put("w", c.w());
            row.put("h", c.h());
            row.put("zIndex", c.zIndex());
            row.put("props", c.props() == null ? Map.of() : c.props());
            comps.add(row);
        }
        snap.put("components", comps);
        Map<String, Object> charts = new LinkedHashMap<>();
        d.charts().forEach((id, ch) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", ch.id());
            row.put("datasetId", ch.datasetId());
            row.put("chartType", ch.chartType());
            row.put("title", ch.title());
            row.put("encode", ch.encode());
            row.put("style", ch.style());
            row.put("senior", ch.senior());
            charts.put(id, row);
        });
        snap.put("charts", charts);
        return snap;
    }

    private static Map<String, Object> castMap(Map<?, ?> m) {
        Map<String, Object> out = new LinkedHashMap<>();
        m.forEach((k, v) -> out.put(String.valueOf(k), v));
        return out;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }

    private static int intVal(Object o, int def) {
        if (o instanceof Number n) return n.intValue();
        if (o == null) return def;
        try {
            return Integer.parseInt(String.valueOf(o));
        } catch (NumberFormatException e) {
            return def;
        }
    }

    private static String truncate(String s, int n) {
        return s.length() <= n ? s : s.substring(0, n);
    }
}
