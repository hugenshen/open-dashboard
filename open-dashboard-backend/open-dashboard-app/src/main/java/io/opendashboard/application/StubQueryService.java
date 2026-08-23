package io.opendashboard.application;

import io.opendashboard.application.conversation.ReadSqlGuard;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import io.opendashboard.domain.QueryDtos.ColumnMeta;
import io.opendashboard.domain.QueryDtos.DatasetQueryRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.QueryDtos.FieldMeta;
import io.opendashboard.domain.datasource.ConnectionSpec;
import io.opendashboard.domain.gateway.DataSourcePort;
import io.opendashboard.domain.gateway.DataSourcePort.Agg;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class StubQueryService {

    private static final Pattern OD_SAMPLE = Pattern.compile(
            "/\\*\\s*od_sample\\s+est=(-?\\d+)\\s+n=(\\d+)\\s*\\*/",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern OD_SCALED = Pattern.compile(
            "/\\*\\s*scaled\\s+x([0-9.]+)\\s*\\*/",
            Pattern.CASE_INSENSITIVE);

    /**
     * Parse sampling markers from SQL comments into chart/sql {@code extra}.
     * Preview-grade aggregates on large tables carry {@code od_sample}/{@code scaled}.
     */
    public static void putSampleMeta(Map<String, Object> extra, String sql) {
        if (extra == null || sql == null || sql.isBlank()) return;
        Matcher sample = OD_SAMPLE.matcher(sql);
        if (sample.find()) {
            extra.put("sampled", true);
            try {
                extra.put("estRows", Long.parseLong(sample.group(1)));
            } catch (NumberFormatException ignored) { /* keep sampled */ }
            try {
                extra.put("sampleN", Integer.parseInt(sample.group(2)));
            } catch (NumberFormatException ignored) { /* keep sampled */ }
        }
        Matcher scaled = OD_SCALED.matcher(sql);
        if (scaled.find()) {
            extra.put("sampled", true);
            try {
                extra.put("scaleFactor", Double.parseDouble(scaled.group(1)));
            } catch (NumberFormatException ignored) { /* keep sampled */ }
        }
    }

    private final ObjectProvider<CatalogService> catalogService;
    private final ObjectProvider<DatasetService> datasetService;
    private final ObjectProvider<DatasourceService> datasourceService;
    private final DataSourcePort jdbc;
    private final boolean stubQuery;
    private final FileTableStore fileTables;
    private final QueryGuard queryGuard;

    public StubQueryService(
            ObjectProvider<CatalogService> catalogService,
            ObjectProvider<DatasetService> datasetService,
            ObjectProvider<DatasourceService> datasourceService,
            DataSourcePort jdbc,
            FileTableStore fileTables,
            QueryGuard queryGuard,
            @Value("${opendashboard.stub-query:true}") boolean stubQuery
    ) {
        this.catalogService = catalogService;
        this.datasetService = datasetService;
        this.datasourceService = datasourceService;
        this.jdbc = jdbc;
        this.fileTables = fileTables;
        this.queryGuard = queryGuard;
        this.stubQuery = stubQuery;
    }

    /** Propagate user stop / agent abort to in-flight JDBC statements. */
    public int cancelLiveQueries(String owner) {
        return jdbc.cancelLiveQueries(owner);
    }

    public Map<String, Object> liveQueryStats() {
        return jdbc.liveQueryStats();
    }

    public DatasetQueryResult execute(DatasetQueryRequest request) {
        DatasetQueryRequest gated = queryGuard.applyToRequest(request);
        String datasetId = gated.datasetId() == null ? "" : gated.datasetId();
        DatasetQueryResult imported = fileTables.query(gated);
        if (imported != null) return queryGuard.stripHidden(datasetId, imported);
        DatasetQueryResult live = tryLive(gated);
        if (live != null && !isLiveQueryFailed(live)) {
            return queryGuard.stripHidden(datasetId, live);
        }
        if (!stubQuery) {
            if (live != null) return queryGuard.stripHidden(datasetId, live);
            // Never invent demo rows when stub-query is off — return empty with honest SQL note.
            long start = System.currentTimeMillis();
            return new DatasetQueryResult(
                    List.of(),
                    List.of(),
                    false,
                    "-- live query unavailable: dataset=" + datasetId + " (stub fallback disabled)",
                    System.currentTimeMillis() - start
            );
        }
        DatasetQueryResult stub = stubExecute(gated);
        if (live != null && (stub.rows() == null || stub.rows().isEmpty()) && !hasStubRows(datasetId)) {
            return queryGuard.stripHidden(datasetId, live);
        }
        return queryGuard.stripHidden(datasetId, stub);
    }

    private static boolean isLiveQueryFailed(DatasetQueryResult result) {
        return result != null && result.sql() != null && result.sql().startsWith("-- live query failed:");
    }

    private DatasetQueryResult tryLive(DatasetQueryRequest request) {
        try {
            DatasetService dsSvc = datasetService.getIfAvailable();
            DatasourceService srcSvc = datasourceService.getIfAvailable();
            if (dsSvc == null || srcSvc == null) return null;
            String datasetId = request.datasetId() == null ? "" : request.datasetId();
            if (datasetId.isBlank()) return null;
            DatasetDetailVO detail = dsSvc.get(datasetId).orElse(null);
            if (detail == null) return null;
            String table = detail.meta().tableName();
            String srcId = detail.meta().datasourceId();
            if (table == null || table.isBlank() || srcId == null) return null;
            ConnectionSpec spec = srcSvc.resolveSpec(srcId).orElse(null);
            if (spec == null || !spec.isJdbc()) return null;

            List<String> dims = new ArrayList<>();
            if (request.dimensions() != null) {
                for (Map<String, Object> d : request.dimensions()) {
                    Object f = d.get("field");
                    if (f != null) dims.add(String.valueOf(f));
                }
            }
            List<Agg> measures = new ArrayList<>();
            if (request.measures() != null) {
                for (Map<String, Object> m : request.measures()) {
                    Object f = m.get("field");
                    if (f == null) continue;
                    String agg = m.get("agg") == null ? "SUM" : String.valueOf(m.get("agg"));
                    String alias = m.get("alias") == null ? String.valueOf(f) : String.valueOf(m.get("alias"));
                    measures.add(new Agg(String.valueOf(f), agg, alias));
                }
            }
            int limit = request.limit() == null || request.limit() <= 0
                    ? 1000
                    : Math.min(request.limit(), 1000);
            return jdbc.queryTable(spec, table, dims, measures, request.columns(), request.filters(), limit);
        } catch (IllegalStateException e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            return new DatasetQueryResult(
                    List.of(),
                    List.of(),
                    false,
                    "-- live query blocked: " + msg,
                    0
            );
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            return new DatasetQueryResult(
                    List.of(),
                    List.of(),
                    false,
                    "-- live query failed: " + msg,
                    0
            );
        }
    }

    /** SQLBot Ask-3: execute a harness-validated SELECT against the dataset's physical table. */
    public DatasetQueryResult executeReadSql(String datasetId, String sql, Integer limit) {
        String safe = queryGuard.wrapSql(datasetId, ReadSqlGuard.requireSelect(sql));
        if (fileTables.has(datasetId)) {
            DatasetQueryResult landed = fileTables.scan(datasetId, limit);
            if (landed != null) {
                return queryGuard.stripHidden(datasetId, new DatasetQueryResult(
                        landed.columns(),
                        landed.rows(),
                        landed.truncated(),
                        safe,
                        landed.elapsedMs()
                ));
            }
        }
        DatasetService dsSvc = datasetService.getIfAvailable();
        DatasourceService srcSvc = datasourceService.getIfAvailable();
        if (dsSvc == null || srcSvc == null) {
            throw new IllegalStateException("数据集服务不可用");
        }
        if (datasetId == null || datasetId.isBlank()) {
            throw new IllegalArgumentException("datasetId 不能为空");
        }
        DatasetDetailVO detail = dsSvc.get(datasetId).orElseThrow(() -> new IllegalArgumentException("数据集不存在"));
        String table = detail.meta().tableName();
        String srcId = detail.meta().datasourceId();
        if (table == null || table.isBlank() || srcId == null) {
            throw new IllegalArgumentException("数据集未绑定物理表");
        }
        ConnectionSpec spec = srcSvc.resolveSpec(srcId).orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        if (!spec.isJdbc()) {
            throw new IllegalArgumentException("该数据源不支持 SQL 查询");
        }
        String ident = table.toLowerCase();
        if (!safe.toLowerCase().contains(ident)) {
            throw new IllegalArgumentException("SQL 必须查询当前数据集表: " + table);
        }
        int lim = limit == null || limit <= 0 ? 1000 : Math.min(limit, 1000);
        return queryGuard.stripHidden(datasetId, jdbc.executeSql(spec, safe, lim));
    }

    private DatasetQueryResult stubExecute(DatasetQueryRequest request) {
        long start = System.currentTimeMillis();
        String datasetId = request.datasetId() == null ? "" : request.datasetId();
        if (datasetId.isBlank()) {
            return new DatasetQueryResult(
                    List.of(),
                    List.of(),
                    false,
                    "-- stub: datasetId required (not falling back to ds_sales)",
                    System.currentTimeMillis() - start
            );
        }
        List<Map<String, Object>> table = FilterAst.apply(stubTable(datasetId), request.filters());
        boolean hasDim = request.dimensions() != null && !request.dimensions().isEmpty();
        String dim = hasDim ? firstField(request.dimensions(), defaultDim(datasetId)) : null;
        String measure = firstField(request.measures(), defaultMeasure(datasetId));
        String agg = firstAgg(request.measures(), "SUM");

        List<List<Object>> rows;
        List<ColumnMeta> columns;
        if (dim == null) {
            List<Number> values = table.stream()
                    .map(r -> toNumber(r.get(measure)))
                    .toList();
            columns = List.of(new ColumnMeta(measure, "DECIMAL", measure, agg));
            rows = values.isEmpty()
                    ? List.of()
                    : List.of(List.of(aggregate(values, agg)));
        } else {
            columns = List.of(
                    new ColumnMeta(dim, "STRING", dim, null),
                    new ColumnMeta(measure, "DECIMAL", measure, agg)
            );
            rows = stubRows(table, dim, measure, agg);
        }
        return new DatasetQueryResult(
                columns,
                rows,
                false,
                rows.isEmpty()
                        ? "-- stub: empty dataset=" + datasetId + " (no demo rows; not falling back to ds_sales)"
                        : "-- stub: dataset=" + datasetId,
                System.currentTimeMillis() - start
        );
    }

    private static double aggregate(List<? extends Number> data, String agg) {
        if (data == null || data.isEmpty()) return 0;
        double sum = data.stream().mapToDouble(Number::doubleValue).sum();
        if ("AVG".equalsIgnoreCase(agg) || "AVERAGE".equalsIgnoreCase(agg)) {
            return sum / data.size();
        }
        if ("COUNT".equalsIgnoreCase(agg)) {
            return data.size();
        }
        if ("MAX".equalsIgnoreCase(agg)) {
            return data.stream().mapToDouble(Number::doubleValue).max().orElse(0);
        }
        if ("MIN".equalsIgnoreCase(agg)) {
            return data.stream().mapToDouble(Number::doubleValue).min().orElse(0);
        }
        return sum;
    }

    private static Number toNumber(Object raw) {
        if (raw instanceof Number n) return n;
        if (raw == null) return 0;
        try {
            return Double.parseDouble(String.valueOf(raw));
        } catch (Exception e) {
            return 0;
        }
    }

    private static String defaultDim(String datasetId) {
        return switch (datasetId) {
            case "ds_ops" -> "module";
            case "ds_fin" -> "month";
            default -> "region";
        };
    }

    private static String defaultMeasure(String datasetId) {
        return switch (datasetId) {
            case "ds_ops" -> "uv";
            case "ds_fin" -> "income";
            default -> "amount";
        };
    }

    private static String firstField(List<Map<String, Object>> fields, String fallback) {
        if (fields == null || fields.isEmpty()) return fallback;
        Object f = fields.getFirst().get("field");
        return f == null ? fallback : String.valueOf(f);
    }

    private static String firstAgg(List<Map<String, Object>> fields, String fallback) {
        if (fields == null || fields.isEmpty()) return fallback;
        Object a = fields.getFirst().get("agg");
        return a == null ? fallback : String.valueOf(a);
    }

    private static List<List<Object>> stubRows(
            List<Map<String, Object>> table,
            String dim,
            String measure,
            String agg
    ) {
        Map<String, List<Number>> grouped = new LinkedHashMap<>();
        for (Map<String, Object> row : table) {
            String key = String.valueOf(row.getOrDefault(dim, "其他"));
            grouped.computeIfAbsent(key, k -> new ArrayList<>()).add(toNumber(row.get(measure)));
        }
        if (grouped.isEmpty()) {
            return List.of();
        }
        List<List<Object>> out = new ArrayList<>();
        for (Map.Entry<String, List<Number>> e : grouped.entrySet()) {
            out.add(List.of(e.getKey(), aggregate(e.getValue(), agg)));
        }
        return out;
    }

    private static List<Map<String, Object>> stubTable(String datasetId) {
        if ("ds_ops".equals(datasetId)) {
            return List.of(
                    row("day", "周一", "module", "首页", "platform", "App", "channel", "自然",
                            "uv", 1200, "pv", 3400, "bounce", 0.32, "duration", 48),
                    row("day", "周一", "module", "详情", "platform", "H5", "channel", "投放",
                            "uv", 800, "pv", 2100, "bounce", 0.41, "duration", 36),
                    row("day", "周二", "module", "搜索", "platform", "App", "channel", "分享",
                            "uv", 420, "pv", 980, "bounce", 0.25, "duration", 55),
                    row("day", "周二", "module", "首页", "platform", "App", "channel", "自然",
                            "uv", 1400, "pv", 3900, "bounce", 0.28, "duration", 52),
                    row("day", "周三", "module", "结算", "platform", "App", "channel", "投放",
                            "uv", 620, "pv", 1500, "bounce", 0.22, "duration", 70),
                    row("day", "周四", "module", "详情", "platform", "H5", "channel", "分享",
                            "uv", 760, "pv", 1900, "bounce", 0.36, "duration", 38)
            );
        }
        if ("ds_fin".equals(datasetId)) {
            return List.of(
                    row("month", "4月", "subject", "商品销售", "dept", "电商",
                            "income", 760000, "expense", 480000, "profit", 280000),
                    row("month", "4月", "subject", "服务费", "dept", "零售",
                            "income", 110000, "expense", 38000, "profit", 72000),
                    row("month", "5月", "subject", "商品销售", "dept", "电商",
                            "income", 820000, "expense", 510000, "profit", 310000),
                    row("month", "5月", "subject", "广告投放", "dept", "市场",
                            "income", 0, "expense", 95000, "profit", -95000),
                    row("month", "6月", "subject", "商品销售", "dept", "电商",
                            "income", 910000, "expense", 560000, "profit", 350000),
                    row("month", "7月", "subject", "人力成本", "dept", "中台",
                            "income", 0, "expense", 185000, "profit", -185000)
            );
        }
        if ("ds_sales".equals(datasetId)) {
            return List.of(
                    row("region", "华东", "channel", "线上", "product", "A", "salesman", "张三",
                            "amount", 1200, "qty", 30, "profit", 420, "order_cnt", 12),
                    row("region", "华东", "channel", "线下", "product", "B", "salesman", "李四",
                            "amount", 860, "qty", 18, "profit", 210, "order_cnt", 8),
                    row("region", "华北", "channel", "线上", "product", "A", "salesman", "王五",
                            "amount", 980, "qty", 22, "profit", 300, "order_cnt", 10),
                    row("region", "华北", "channel", "投放", "product", "C", "salesman", "张三",
                            "amount", 640, "qty", 14, "profit", 160, "order_cnt", 6),
                    row("region", "华南", "channel", "线上", "product", "B", "salesman", "赵六",
                            "amount", 760, "qty", 16, "profit", 190, "order_cnt", 7),
                    row("region", "华南", "channel", "线下", "product", "C", "salesman", "李四",
                            "amount", 520, "qty", 11, "profit", 120, "order_cnt", 5)
            );
        }
        // Unknown / user datasets: do NOT silently reuse sales demo rows.
        return List.of();
    }

    private static boolean hasStubRows(String datasetId) {
        return !stubTable(datasetId).isEmpty();
    }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return m;
    }

    public ChartQueryResult query(ChartQueryRequest request) {
        queryGuard.requireDashboardView(request.dashboardId());
        Map<String, Object> inline = request.inline();
        String datasetId = null;
        String chartType = "bar";
        String category = null;
        String value = null;
        String agg = "SUM";

        if (request.dashboardId() != null && request.chartId() != null) {
            CatalogService catalog = catalogService.getObject();
            Map<String, Object> resolved = catalog.resolveChartEncode(
                    request.dashboardId(),
                    request.chartId(),
                    request.view()
            );
            if (!resolved.isEmpty()) {
                chartType = String.valueOf(resolved.getOrDefault("chartType", chartType));
                String[] bound = bindEncode(resolved, resolved.get("encode") instanceof Map<?, ?> encMap ? encMap : Map.of());
                if (bound[0] != null) datasetId = bound[0];
                if (bound[1] != null) category = bound[1];
                if (bound[2] != null) value = bound[2];
                if (bound[3] != null) agg = bound[3];
            }
        }
        if (inline != null) {
            Object ct = inline.get("chartType");
            if (ct != null && !String.valueOf(ct).isBlank()) {
                chartType = String.valueOf(ct);
            }
            String[] bound = bindEncode(inline, inline.get("encode") instanceof Map<?, ?> encMap ? encMap : Map.of());
            if (bound[0] != null) datasetId = bound[0];
            if (bound[1] != null) category = bound[1];
            if (bound[2] != null) value = bound[2];
            if (bound[3] != null) agg = bound[3];
        }

        if (datasetId == null || datasetId.isBlank() || value == null || value.isBlank()) {
            Map<String, Object> extra = new HashMap<>();
            extra.put("error", "chart encode missing datasetId/value");
            extra.put("chartId", request.chartId() == null ? "" : request.chartId());
            extra.put("dashboardId", request.dashboardId() == null ? "" : request.dashboardId());
            return new ChartQueryResult(List.of(), List.of(), Map.of(), extra);
        }
        if (!"kpi".equals(chartType) && (category == null || category.isBlank())) {
            Map<String, Object> extra = new HashMap<>();
            extra.put("error", "chart encode missing category");
            extra.put("chartId", request.chartId() == null ? "" : request.chartId());
            extra.put("dashboardId", request.dashboardId() == null ? "" : request.dashboardId());
            return new ChartQueryResult(List.of(), List.of(), Map.of(), extra);
        }

        List<Map<String, Object>> dims = "kpi".equals(chartType)
                ? List.of()
                : List.of(Map.of("field", category));
        Map<String, Object> filters = extractFilters(inline, encMap(inline), request.context());
        int rowLimit = chartResultLimit(inline);
        DatasetQueryRequest dsReq = new DatasetQueryRequest(
                datasetId,
                dims,
                List.of(Map.of("field", value, "agg", agg)),
                null,
                filters,
                rowLimit,
                Map.of("includeSql", true)
        );
        DatasetQueryResult table = execute(dsReq);
        List<FieldMeta> fields = (table.columns() == null ? List.<ColumnMeta>of() : table.columns()).stream()
                .map(c -> new FieldMeta(c.name(), c.dataType()))
                .toList();

        List<List<Object>> tableRows = table.rows() == null ? List.of() : table.rows();
        List<String> categories = tableRows.stream()
                .map(r -> String.valueOf(r.getFirst()))
                .toList();
        List<Number> data = tableRows.stream()
                .map(r -> {
                    Object v = r.size() > 1 ? r.get(1) : r.getFirst();
                    if (v instanceof Number n) return n;
                    try {
                        return Double.parseDouble(String.valueOf(v));
                    } catch (Exception e) {
                        return 0;
                    }
                })
                .toList();

        Map<String, Object> extra = new HashMap<>();
        extra.put("stub", table.sql() != null && table.sql().startsWith("-- stub"));
        extra.put("sql", table.sql());
        putSampleMeta(extra, table.sql());
        if (table.sql() != null && (table.sql().startsWith("-- live query") || table.sql().contains("超时") || table.sql().contains("繁忙"))) {
            extra.put("error", table.sql());
            extra.put("timedOut", table.sql().contains("超时") || table.sql().toLowerCase().contains("timeout"));
        }
        extra.put("chartType", chartType);
        extra.put("chartId", request.chartId() == null ? "" : request.chartId());
        extra.put("dashboardId", request.dashboardId() == null ? "" : request.dashboardId());
        extra.put("inline", inline != null);
        if (filters != null && !filters.isEmpty()) extra.put("filters", filters);

        if ("kpi".equals(chartType)) {
            double kpi = aggregate(data, agg);
            return new ChartQueryResult(
                    fields,
                    tableRows,
                    Map.of("kpi", kpi, "label", value),
                    extra
            );
        }

        String seriesType = switch (chartType) {
            case "line", "area" -> "line";
            case "pie" -> "pie";
            default -> "bar";
        };

        return new ChartQueryResult(
                fields,
                tableRows,
                Map.of(
                        "categories", categories,
                        "series", List.of(Map.of("name", value, "type", seriesType, "data", data))
                ),
                extra
        );
    }

    /** [datasetId, category, value, agg]; null slot means absent. Nested encode first, top-level wins. */
    private static String[] bindEncode(Map<String, Object> top, Map<?, ?> enc) {
        String[] out = new String[4];
        applyEncodeSlot(out, enc);
        applyEncodeSlot(out, top);
        return out;
    }

    /** Cap chart series/detail rows; default 1000 to avoid unbounded GROUP BY result sets. */
    private static int chartResultLimit(Map<String, Object> inline) {
        Object raw = null;
        if (inline != null) {
            if (inline.get("resultLimit") != null) raw = inline.get("resultLimit");
            else if (inline.get("encode") instanceof Map<?, ?> enc && enc.get("resultLimit") != null) {
                raw = enc.get("resultLimit");
            }
        }
        int n = 1000;
        if (raw instanceof Number num) n = num.intValue();
        else if (raw != null) {
            try {
                n = Integer.parseInt(String.valueOf(raw));
            } catch (NumberFormatException ignored) {
                n = 1000;
            }
        }
        if (n <= 0) n = 1000;
        return Math.min(n, 1000);
    }

    private static void applyEncodeSlot(String[] out, Map<?, ?> m) {
        if (m == null) return;
        Object ds = m.get("datasetId");
        // Accept x/y aliases from conversation tools (P011 od_run_query).
        Object cat = m.get("category") != null ? m.get("category") : m.get("x");
        Object val = m.get("value") != null ? m.get("value") : m.get("y");
        Object agg = m.get("agg");
        if (ds != null && !String.valueOf(ds).isBlank()) out[0] = String.valueOf(ds);
        if (cat != null && !String.valueOf(cat).isBlank() && !(cat instanceof List<?>)) out[1] = String.valueOf(cat);
        if (cat instanceof List<?> list && !list.isEmpty() && list.getFirst() != null) {
            out[1] = String.valueOf(list.getFirst());
        }
        if (val != null && !String.valueOf(val).isBlank() && !(val instanceof List<?>)) out[2] = String.valueOf(val);
        if (val instanceof List<?> list && !list.isEmpty() && list.getFirst() != null) {
            out[2] = String.valueOf(list.getFirst());
        }
        // Dim-only distribution → COUNT on the category field
        if (out[1] != null && (out[2] == null || out[2].isBlank())) {
            out[2] = out[1];
            if (out[3] == null || out[3].isBlank()) out[3] = "COUNT";
        }
        if (agg != null && !String.valueOf(agg).isBlank()) out[3] = String.valueOf(agg);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> extractFilters(
            Map<String, Object> inline,
            Map<?, ?> enc,
            Map<String, Object> context
    ) {
        Map<String, Object> ast = null;
        if (enc != null && enc.get("filters") instanceof Map<?, ?> fm) {
            ast = castFilterMap(fm);
        } else if (inline != null && inline.get("filters") instanceof Map<?, ?> fm) {
            ast = castFilterMap(fm);
        }
        return mergeFilterAst(ast, contextFiltersToAst(context));
    }

    private static Map<String, Object> contextFiltersToAst(Map<String, Object> context) {
        if (context == null) return null;
        Object raw = context.get("filters");
        if (raw instanceof Map<?, ?> fm) return castFilterMap(fm);
        if (!(raw instanceof List<?> list) || list.isEmpty()) return null;
        List<Map<String, Object>> items = new ArrayList<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> m)) continue;
            String field = m.get("field") == null ? "" : String.valueOf(m.get("field"));
            if (field.isBlank()) continue;
            String op = m.get("operator") == null
                    ? (m.get("op") == null ? "eq" : String.valueOf(m.get("op")))
                    : String.valueOf(m.get("operator"));
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("field", field);
            String lop = op.toLowerCase();
            Object value = m.get("value");
            if ("between".equals(lop) && value instanceof List<?> pair && pair.size() >= 2) {
                item.put("op", "between");
                item.put("from", pair.get(0));
                item.put("to", pair.get(1));
            } else {
                item.put("op", lop.isBlank() ? "eq" : lop);
                item.put("value", value);
                if (m.get("n") != null) item.put("n", m.get("n"));
                if (m.get("unit") != null) item.put("unit", m.get("unit"));
            }
            items.add(item);
        }
        return items.isEmpty() ? null : Map.of("items", items);
    }

    private static Map<String, Object> mergeFilterAst(Map<String, Object> a, Map<String, Object> b) {
        if (a == null || a.isEmpty()) return b;
        if (b == null || b.isEmpty()) return a;
        List<Object> items = new ArrayList<>();
        if (a.get("items") instanceof List<?> la) items.addAll(la);
        if (b.get("items") instanceof List<?> lb) items.addAll(lb);
        Map<String, Object> out = new LinkedHashMap<>(a);
        out.put("items", items);
        return out;
    }

    private static Map<?, ?> encMap(Map<String, Object> inline) {
        if (inline == null) return Map.of();
        return inline.get("encode") instanceof Map<?, ?> m ? m : Map.of();
    }

    private static Map<String, Object> castFilterMap(Map<?, ?> raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        raw.forEach((k, v) -> out.put(String.valueOf(k), v));
        return out;
    }
}
