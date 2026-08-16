package io.opendashboard.application.conversation;

import io.opendashboard.application.DashboardAppService;
import io.opendashboard.application.DatasetService;
import io.opendashboard.application.DatasourceService;
import io.opendashboard.application.FileTableStore;
import io.opendashboard.application.StubQueryService;
import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentVO;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import io.opendashboard.domain.QueryDtos.DatasetQueryRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Platform BI facade for DeerFlow / opendashboard-harness (no AI). */
@Service
public class BiPlatformService {

    private final DatasetService datasets;
    private final DatasourceService datasources;
    private final StubQueryService queryService;
    private final DashboardAppService dashboards;
    private final DashboardPatchApplier applier;
    private final DatasetProfiler profiler;
    private final FileTableStore fileTables;

    public BiPlatformService(
            DatasetService datasets,
            DatasourceService datasources,
            StubQueryService queryService,
            DashboardAppService dashboards,
            DashboardPatchApplier applier,
            DatasetProfiler profiler,
            FileTableStore fileTables
    ) {
        this.datasets = datasets;
        this.datasources = datasources;
        this.queryService = queryService;
        this.dashboards = dashboards;
        this.applier = applier;
        this.profiler = profiler;
        this.fileTables = fileTables;
    }

    public List<Map<String, Object>> listDatasets() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (DatasetMetaVO m : datasets.list()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", m.id());
            row.put("name", m.name());
            row.put("folder", m.folder());
            row.put("tableName", m.tableName());
            row.put("datasourceId", m.datasourceId());
            row.put("status", m.status());
            out.add(row);
        }
        return out;
    }

    public Optional<Map<String, Object>> schema(String datasetId) {
        return datasets.get(datasetId).map(d -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", d.meta().id());
            m.put("name", d.meta().name());
            m.put("tableName", d.meta().tableName());
            m.put("folder", d.meta().folder());
            List<Map<String, Object>> fields = new ArrayList<>();
            if (d.fields() != null) {
                d.fields().forEach(f -> {
                    Map<String, Object> ff = new LinkedHashMap<>();
                    ff.put("name", f.name());
                    ff.put("label", f.label());
                    ff.put("group", f.group());
                    ff.put("dataType", f.dataType());
                    ff.put("origin", f.origin());
                    ff.put("role", DatasetProfiler.roleOf(f));
                    fields.add(ff);
                });
            }
            m.put("fields", fields);
            if (fileTables.has(d.meta().id()) || (d.meta().tableName() != null && d.meta().tableName().startsWith("od_file_"))) {
                m.put("engine", "file");
            }
            if (d.meta().datasourceId() != null) {
                datasources.get(d.meta().datasourceId()).ifPresent(src -> {
                    m.put("engine", src.type());
                    m.put("datasourceName", src.name());
                    m.put("dbName", src.dbName());
                    m.put("schemaName", src.schema());
                });
            }
            return m;
        });
    }

    public DatasetQueryResult datasetQuery(DatasetQueryRequest request) {
        return queryService.execute(request);
    }

    public ChartQueryResult chartQuery(ChartQueryRequest request) {
        return queryService.query(request);
    }

    public Map<String, Object> executeReadSql(Map<String, Object> body) {
        String datasetId = body == null || body.get("datasetId") == null ? "" : String.valueOf(body.get("datasetId"));
        String sql = body == null || body.get("sql") == null ? "" : String.valueOf(body.get("sql"));
        Integer limit = null;
        if (body != null && body.get("limit") instanceof Number n) limit = n.intValue();
        DatasetQueryResult r = queryService.executeReadSql(datasetId, sql, limit);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sql", r.sql());
        out.put("elapsedMs", r.elapsedMs());
        out.put("truncated", r.truncated());
        List<Map<String, Object>> fields = new ArrayList<>();
        if (r.columns() != null) {
            for (var c : r.columns()) {
                Map<String, Object> f = new LinkedHashMap<>();
                f.put("name", c.name());
                f.put("type", c.dataType());
                fields.add(f);
            }
        }
        out.put("fields", fields);
        out.put("data", r.rows() == null ? List.of() : r.rows());
        out.put("rowCount", r.rows() == null ? 0 : r.rows().size());
        return out;
    }

    public Map<String, Object> profileDataset(String datasetId) {
        return profiler.profile(datasetId);
    }

    public Map<String, Object> resolveIntent(Map<String, Object> body) {
        String message = body == null || body.get("message") == null ? "" : String.valueOf(body.get("message"));
        List<String> datasetIds = new ArrayList<>();
        if (body != null && body.get("datasetIds") instanceof List<?> raw) {
            for (Object o : raw) {
                if (o != null && !String.valueOf(o).isBlank()) datasetIds.add(String.valueOf(o));
            }
        }
        Map<String, DatasetDetailVO> loaded = new LinkedHashMap<>();
        if (datasetIds.isEmpty()) {
            for (DatasetMetaVO meta : datasets.list()) {
                if (meta == null || meta.id() == null) continue;
                datasets.get(meta.id()).ifPresent(d -> loaded.put(meta.id(), d));
                if (loaded.size() >= 8) break;
            }
            datasetIds.addAll(loaded.keySet());
        } else {
            for (String id : datasetIds) {
                datasets.get(id).ifPresent(d -> loaded.put(id, d));
            }
        }
        SchemaGuard.SchemaBundle schema = SchemaGuard.load(datasetIds, loaded);
        return IntentResolver.resolve(message, schema).toMap();
    }

    public Map<String, Object> boardSummary(String dashboardId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("dashboardId", dashboardId);
        if (dashboardId == null || dashboardId.isBlank()) {
            out.put("charts", List.of());
            out.put("components", List.of());
            return out;
        }
        Optional<DashboardDetailVO> detail = dashboards.get(dashboardId, "draft");
        if (detail.isEmpty()) {
            out.put("charts", List.of());
            out.put("components", List.of());
            return out;
        }
        DashboardDetailVO d = detail.get();
        List<Map<String, Object>> charts = new ArrayList<>();
        if (d.charts() != null) {
            d.charts().forEach((id, ch) -> charts.add(chartSummary(id, ch)));
        }
        List<Map<String, Object>> comps = new ArrayList<>();
        if (d.components() != null) {
            for (DashboardComponentVO c : d.components()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", c.id());
                row.put("chartId", c.chartViewId());
                row.put("x", c.x());
                row.put("y", c.y());
                row.put("w", c.w());
                row.put("h", c.h());
                comps.add(row);
            }
        }
        out.put("name", d.meta() == null ? null : d.meta().name());
        out.put("charts", charts);
        out.put("components", comps);
        return out;
    }

    private static Map<String, Object> chartSummary(String id, ChartViewVO ch) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("chartId", id);
        row.put("title", ch.title());
        row.put("chartType", ch.chartType());
        row.put("datasetId", ch.datasetId());
        row.put("encode", ch.encode());
        return row;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> applyPatch(Map<String, Object> body) {
        String dashboardId = body.get("dashboardId") == null ? null : String.valueOf(body.get("dashboardId"));
        String title = body.get("title") == null ? "AI 生成看板" : String.valueOf(body.get("title"));
        String mode = body.get("mode") == null ? "replace" : String.valueOf(body.get("mode"));
        Object patchObj = body.get("patch");
        Map<String, Object> patchMap;
        if (patchObj instanceof Map<?, ?> m) {
            patchMap = new LinkedHashMap<>();
            m.forEach((k, v) -> patchMap.put(String.valueOf(k), v));
        } else {
            patchMap = new LinkedHashMap<>();
            patchMap.put("dashboardId", dashboardId);
            patchMap.put("ops", body.get("ops") == null ? List.of() : body.get("ops"));
        }
        if ("replace".equalsIgnoreCase(mode) && dashboardId != null && !dashboardId.isBlank()) {
            patchMap.put("dashboardId", dashboardId);
        }
        DashboardPatch.Patch patch = DashboardPatch.Patch.fromMap(patchMap);
        DashboardPatchApplier.ApplyResult applied = applier.apply(dashboardId, title, patch, mode);

        List<Map<String, Object>> preview = new ArrayList<>();
        for (String chartId : applied.chartIds()) {
            Map<String, Object> inline = findChartInline(patch, chartId);
            ChartQueryResult result = queryService.query(new ChartQueryRequest(
                    chartId, applied.dashboardId(), "draft", inline.isEmpty() ? null : inline, Map.of()
            ));
            List<List<Object>> data = result.data() == null ? List.of() : result.data();
            Map<String, Object> card = new LinkedHashMap<>();
            card.put("chartId", chartId);
            card.put("dashboardId", applied.dashboardId());
            card.put("title", inline.getOrDefault("title", chartId));
            card.put("chartType", inline.getOrDefault("chartType", "bar"));
            card.put("datasetId", inline.get("datasetId"));
            card.put("encode", inline.getOrDefault("encode", Map.of()));
            card.put("rowCount", data.size());
            card.put("labels", previewLabels(data));
            card.put("heights", previewHeights(data));
            boolean kpi = "kpi".equals(String.valueOf(inline.get("chartType")));
            Object kpiVal = null;
            if (kpi && !data.isEmpty() && !data.getFirst().isEmpty()) {
                Object raw = data.getFirst().size() > 1 ? data.getFirst().get(1) : data.getFirst().getFirst();
                if (raw != null && !"".equals(raw) && !"null".equalsIgnoreCase(String.valueOf(raw))) {
                    kpiVal = raw;
                    card.put("kpiValue", raw);
                }
            }
            if (data.isEmpty() || (kpi && kpiVal == null)) {
                continue;
            }
            preview.add(card);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("dashboardId", applied.dashboardId());
        out.put("chartIds", applied.chartIds());
        out.put("charts", preview);
        out.put("query", extractQuery(patch));
        out.put("mode", mode);
        return out;
    }

    public Map<String, Object> composeBoard(Map<String, Object> body) {
        String message = body.get("message") == null ? "" : String.valueOf(body.get("message"));
        String dashboardId = body.get("dashboardId") == null ? null : String.valueOf(body.get("dashboardId"));
        String styleId = body.get("styleId") == null ? "feishu-blue" : String.valueOf(body.get("styleId"));
        String mode = body.get("mode") == null ? "replace" : String.valueOf(body.get("mode"));
        @SuppressWarnings("unchecked")
        List<String> datasetIds = body.get("datasetIds") instanceof List<?> list
                ? list.stream().map(String::valueOf).toList()
                : List.of();
        Map<String, DatasetDetailVO> loaded = new LinkedHashMap<>();
        for (String id : datasetIds) {
            datasets.get(id).ifPresent(d -> loaded.put(id, d));
        }
        if (loaded.isEmpty() && !datasetIds.isEmpty()) {
            return Map.of("ok", false, "error", "datasets not found");
        }
        if (loaded.isEmpty()) {
            datasets.list().stream()
                    .filter(m -> !DeterministicPlanner.isWeakDataset(new DatasetDetailVO(m, List.of())))
                    .limit(3)
                    .forEach(m -> datasets.get(m.id()).ifPresent(d -> loaded.put(d.meta().id(), d)));
            if (loaded.isEmpty()) {
                datasets.list().stream().limit(3)
                        .forEach(m -> datasets.get(m.id()).ifPresent(d -> loaded.put(d.meta().id(), d)));
            }
        }
        SchemaGuard.SchemaBundle schema = SchemaGuard.load(new ArrayList<>(loaded.keySet()), loaded);
        if (!schema.okForPagePatch()) {
            return Map.of("ok", false, "error", "schema guard failed", "missing", schema.missingIds());
        }
        DashboardPatch.Patch patch = DeterministicPlanner.plan(dashboardId, styleId, message, schema);
        if ("append".equalsIgnoreCase(mode) && dashboardId != null && !dashboardId.isBlank()) {
            patch = toAppendPatch(dashboardId, patch);
        }
        String title = DeterministicPlanner.resolveTitle(message, schema);
        String usedId = DeterministicPlanner.resolveDatasetId(message, schema);
        DatasetDetailVO used = loaded.get(usedId);
        long chartCount = patch.ops().stream().filter(op -> "upsert_chart".equals(String.valueOf(op.get("op")))).count();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("title", title);
        out.put("mode", mode);
        out.put("datasetId", usedId);
        out.put("datasetName", used != null && used.meta() != null ? used.meta().name() : usedId);
        out.put("weakDataset", DeterministicPlanner.isWeakDataset(used));
        out.put("chartCount", chartCount);
        out.put("patch", patch.toMap());
        return out;
    }

    /** Keep only new charts/components; place below existing board max Y. */
    private DashboardPatch.Patch toAppendPatch(String dashboardId, DashboardPatch.Patch full) {
        Map<String, Object> summary = boardSummary(dashboardId);
        int maxY = 0;
        Object comps = summary.get("components");
        if (comps instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> m) {
                    Object y = m.get("y");
                    Object h = m.get("h");
                    int yi = y instanceof Number n ? n.intValue() : 0;
                    int hi = h instanceof Number n ? n.intValue() : 12;
                    maxY = Math.max(maxY, yi + hi);
                }
            }
        }
        List<Map<String, Object>> chartOps = new ArrayList<>();
        List<Map<String, Object>> compOps = new ArrayList<>();
        for (Map<String, Object> op : full.ops()) {
            String kind = String.valueOf(op.get("op"));
            if ("upsert_chart".equals(kind)) chartOps.add(op);
            else if ("upsert_component".equals(kind)) {
                Map<String, Object> shifted = new LinkedHashMap<>(op);
                int y = op.get("y") instanceof Number n ? n.intValue() : 0;
                shifted.put("y", maxY + 2 + (y % 24));
                compOps.add(shifted);
            }
        }
        int keep = Math.min(2, chartOps.size());
        List<Map<String, Object>> ops = new ArrayList<>();
        for (int i = 0; i < keep; i++) {
            ops.add(chartOps.get(i));
            String chartId = String.valueOf(chartOps.get(i).get("chartId"));
            for (Map<String, Object> c : compOps) {
                if (chartId.equals(String.valueOf(c.get("chartId")))) {
                    ops.add(c);
                    break;
                }
            }
        }
        if (ops.isEmpty()) {
            return full;
        }
        return new DashboardPatch.Patch(dashboardId, ops);
    }

    private static List<String> previewLabels(List<List<Object>> data) {
        List<String> labels = new ArrayList<>();
        for (List<Object> row : data) {
            if (row == null || row.isEmpty() || row.getFirst() == null) continue;
            labels.add(String.valueOf(row.getFirst()));
            if (labels.size() >= 8) break;
        }
        return labels;
    }

    private static List<Integer> previewHeights(List<List<Object>> data) {
        double max = 1;
        for (List<Object> row : data) {
            if (row == null || row.size() < 2 || row.get(1) == null) continue;
            max = Math.max(max, Math.abs(toDouble(row.get(1))));
        }
        List<Integer> heights = new ArrayList<>();
        for (List<Object> row : data) {
            if (row == null || row.size() < 2 || row.get(1) == null) {
                heights.add(12);
            } else {
                heights.add((int) Math.round(Math.max(8, Math.abs(toDouble(row.get(1))) / max * 100)));
            }
            if (heights.size() >= 8) break;
        }
        return heights;
    }

    private static double toDouble(Object o) {
        if (o instanceof Number n) return n.doubleValue();
        try {
            return Double.parseDouble(String.valueOf(o).replace(",", ""));
        } catch (Exception e) {
            return 0;
        }
    }

    private static Map<String, Object> findChartInline(DashboardPatch.Patch patch, String chartId) {
        for (Map<String, Object> op : patch.ops()) {
            if (!"upsert_chart".equals(String.valueOf(op.get("op")))) continue;
            if (!chartId.equals(String.valueOf(op.get("chartId")))) continue;
            Map<String, Object> inline = new LinkedHashMap<>();
            inline.put("datasetId", op.get("datasetId"));
            inline.put("chartType", op.get("type"));
            inline.put("title", op.get("title"));
            inline.put("encode", op.get("encode"));
            return inline;
        }
        return Map.of();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> extractQuery(DashboardPatch.Patch patch) {
        if (patch == null || patch.ops() == null) return null;
        for (Map<String, Object> op : patch.ops()) {
            if (!"upsert_component".equals(String.valueOf(op.get("op")))) continue;
            if (!"query".equals(String.valueOf(op.get("type")))) continue;
            Map<String, Object> query = new LinkedHashMap<>();
            Object propsObj = op.get("props");
            if (propsObj instanceof Map<?, ?> props) {
                Object label = props.get("label");
                query.put("label", label == null || String.valueOf(label).isBlank() ? "查询条件" : label);
                query.put("items", props.get("items") instanceof List<?> items ? items : List.of());
            } else {
                query.put("label", "查询条件");
                query.put("items", List.of());
            }
            return query;
        }
        return null;
    }
}
