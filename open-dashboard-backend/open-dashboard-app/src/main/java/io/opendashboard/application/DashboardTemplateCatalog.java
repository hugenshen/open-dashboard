package io.opendashboard.application;

import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentVO;
import io.opendashboard.domain.DashboardDtos.DashboardLinkageVO;
import io.opendashboard.domain.DashboardDtos.DashboardTemplateVO;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Built-in business-domain dashboard templates.
 * Layouts are authored in 12-col hi-fi units and scaled ×6 to the product 72-col grid.
 */
public final class DashboardTemplateCatalog {

    private static final int GRID_SCALE = 6;

    private DashboardTemplateCatalog() {}

    public static List<DashboardTemplateVO> list() {
        return List.of(
                new DashboardTemplateVO("blank", "空白仪表盘", "通用", "从空画布开始，自行添加组件"),
                new DashboardTemplateVO("sales", "销售分析", "销售", "KPI + 多图 + 查询筛选，区域点击联动明细"),
                new DashboardTemplateVO("ops", "运营看板", "运营", "流量全景 + 查询筛选，模块点击联动明细"),
                new DashboardTemplateVO("finance", "财务概览", "财务", "收支利润 + 查询筛选，科目点击联动明细")
        );
    }

    public static String defaultName(String templateId) {
        String id = normalize(templateId);
        return switch (id) {
            case "sales" -> "销售分析";
            case "ops" -> "运营看板";
            case "finance" -> "财务概览";
            default -> null;
        };
    }

    public static String normalize(String templateId) {
        if (templateId == null || templateId.isBlank()) return "blank";
        String id = templateId.trim().toLowerCase();
        return switch (id) {
            case "blank", "sales", "ops", "finance" -> id;
            default -> "blank";
        };
    }

    public static Blueprint build(String templateId, String dashboardId, LongSupplier idGen) {
        String id = normalize(templateId);
        return switch (id) {
            case "sales" -> sales(dashboardId, idGen);
            case "ops" -> ops(dashboardId, idGen);
            case "finance" -> finance(dashboardId, idGen);
            default -> Blueprint.empty();
        };
    }

    private static Blueprint sales(String dashboardId, LongSupplier idGen) {
        List<Slot> slots = List.of(
                query("查询条件", List.of(
                        selectItem("region", "区域"),
                        selectItem("channel", "渠道"),
                        selectItem("product", "产品")
                ), 0, 0, 12, 1),
                chart("kpi", "本月 GMV", "ds_sales", enc("amount", "SUM"), 0, 1, 3, 2),
                chart("kpi", "本月销量", "ds_sales", enc("qty", "SUM"), 3, 1, 3, 2),
                chart("kpi", "利润", "ds_sales", enc("profit", "SUM"), 6, 1, 3, 2),
                chart("kpi", "订单数", "ds_sales", enc("order_cnt", "SUM"), 9, 1, 3, 2),
                chart("bar", "区域销售额", "ds_sales", enc("region", "amount", "SUM"), 0, 3, 6, 5),
                chart("line", "产品销售趋势", "ds_sales", enc("product", "amount", "SUM"), 6, 3, 6, 5),
                chart("hbar", "销售员业绩", "ds_sales", enc("salesman", "amount", "SUM"), 0, 8, 4, 4),
                chart("pie", "渠道占比", "ds_sales", enc("channel", "amount", "SUM"), 4, 8, 4, 4),
                chart("area", "产品贡献", "ds_sales", enc("product", "qty", "SUM"), 8, 8, 4, 4),
                chart("grouptable", "销售员汇总", "ds_sales", enc("salesman", "amount", "SUM"), 0, 12, 6, 4),
                chart("table", "销售明细", "ds_sales", encRaw("amount"), 6, 12, 6, 4),
                chart("bar", "渠道销售额", "ds_sales", enc("channel", "amount", "SUM"), 0, 16, 6, 4),
                chart("line", "区域销量趋势", "ds_sales", enc("region", "qty", "SUM"), 6, 16, 6, 4)
        );
        return materialize(
                dashboardId, idGen, "default", "销售分析", slots,
                List.of(
                        link("区域销售额", "region", "销售明细", "region"),
                        link("区域销售额", "region", "销售员汇总", "region"),
                        link("区域销售额", "region", "产品销售趋势", "region"),
                        link("渠道占比", "channel", "销售明细", "channel"),
                        link("渠道占比", "channel", "渠道销售额", "channel")
                )
        );
    }

    private static Blueprint ops(String dashboardId, LongSupplier idGen) {
        List<Slot> slots = List.of(
                query("查询条件", List.of(
                        selectItem("module", "模块"),
                        selectItem("platform", "端"),
                        selectItem("channel", "来源")
                ), 0, 0, 12, 1),
                chart("kpi", "周 UV", "ds_ops", enc("uv", "SUM"), 0, 1, 3, 2),
                chart("kpi", "周 PV", "ds_ops", enc("pv", "SUM"), 3, 1, 3, 2),
                chart("kpi", "均停留秒", "ds_ops", enc("duration", "AVG"), 6, 1, 3, 2),
                chart("kpi", "跳出率", "ds_ops", enc("bounce", "AVG"), 9, 1, 3, 2),
                chart("area", "每日 UV 走势", "ds_ops", enc("day", "uv", "SUM"), 0, 3, 8, 5),
                chart("pie", "来源结构", "ds_ops", enc("channel", "uv", "SUM"), 8, 3, 4, 5),
                chart("line", "每日 PV 走势", "ds_ops", enc("day", "pv", "SUM"), 0, 8, 6, 4),
                chart("hbar", "端 UV 对比", "ds_ops", enc("platform", "uv", "SUM"), 6, 8, 6, 4),
                chart("bar", "模块流量", "ds_ops", enc("module", "pv", "SUM"), 0, 12, 5, 4),
                chart("grouptable", "模块汇总", "ds_ops", enc("module", "uv", "SUM"), 5, 12, 7, 4),
                chart("table", "流量明细", "ds_ops", encRaw("uv"), 0, 16, 7, 4),
                chart("pie", "端占比", "ds_ops", enc("platform", "pv", "SUM"), 7, 16, 5, 4)
        );
        return materialize(
                dashboardId, idGen, "ocean", "运营增长", slots,
                List.of(
                        link("模块流量", "module", "流量明细", "module"),
                        link("模块流量", "module", "模块汇总", "module"),
                        link("来源结构", "channel", "流量明细", "channel"),
                        link("端 UV 对比", "platform", "流量明细", "platform"),
                        link("端占比", "platform", "每日 UV 走势", "platform")
                )
        );
    }

    private static Blueprint finance(String dashboardId, LongSupplier idGen) {
        List<Slot> slots = List.of(
                query("查询条件", List.of(
                        selectItem("month", "月份"),
                        selectItem("subject", "科目"),
                        selectItem("dept", "部门")
                ), 0, 0, 12, 1),
                chart("kpi", "累计收入", "ds_fin", enc("income", "SUM"), 0, 1, 4, 2),
                chart("kpi", "累计支出", "ds_fin", enc("expense", "SUM"), 4, 1, 4, 2),
                chart("kpi", "累计利润", "ds_fin", enc("profit", "SUM"), 8, 1, 4, 2),
                chart("line", "月度收入", "ds_fin", enc("month", "income", "SUM"), 0, 3, 6, 4),
                chart("area", "月度支出", "ds_fin", enc("month", "expense", "SUM"), 6, 3, 6, 4),
                chart("bar", "科目支出结构", "ds_fin", enc("subject", "expense", "SUM"), 0, 7, 5, 4),
                chart("hbar", "部门利润", "ds_fin", enc("dept", "profit", "SUM"), 5, 7, 4, 4),
                chart("pie", "科目收入占比", "ds_fin", enc("subject", "income", "SUM"), 9, 7, 3, 4),
                chart("grouptable", "科目汇总", "ds_fin", enc("subject", "expense", "SUM"), 0, 11, 5, 4),
                chart("table", "科目明细", "ds_fin", encRaw("profit"), 5, 11, 7, 4),
                chart("bar", "部门收入", "ds_fin", enc("dept", "income", "SUM"), 0, 15, 6, 4),
                chart("line", "月度利润", "ds_fin", enc("month", "profit", "SUM"), 6, 15, 6, 4)
        );
        return materialize(
                dashboardId, idGen, "default", "财务库存", slots,
                List.of(
                        link("科目支出结构", "subject", "科目明细", "subject"),
                        link("科目支出结构", "subject", "科目汇总", "subject"),
                        link("科目收入占比", "subject", "科目明细", "subject"),
                        link("部门利润", "dept", "科目明细", "dept"),
                        link("部门收入", "dept", "月度利润", "dept")
                )
        );
    }

    private static Map<String, Object> enc(String value, String agg) {
        Map<String, Object> m = new HashMap<>();
        m.put("value", value);
        m.put("agg", agg);
        return m;
    }

    private static Map<String, Object> enc(String category, String value, String agg) {
        Map<String, Object> m = enc(value, agg);
        m.put("category", category);
        return m;
    }

    private static Map<String, Object> encRaw(String value) {
        Map<String, Object> m = enc(value, "SUM");
        m.put("format", "raw");
        return m;
    }

    private static Map<String, Object> selectItem(String field, String label) {
        Map<String, Object> m = new HashMap<>();
        m.put("kind", "select");
        m.put("field", field);
        m.put("label", label);
        m.put("scope", "all");
        m.put("targetChartIds", List.of());
        return m;
    }

    private static Slot query(String label, List<Map<String, Object>> items, int x, int y, int w, int h) {
        Map<String, Object> props = new HashMap<>();
        props.put("label", label);
        props.put("items", items);
        props.put("align", "center");
        return Slot.query(props, x, y, w, h);
    }

    private static Slot chart(
            String chartType,
            String title,
            String datasetId,
            Map<String, Object> encode,
            int x,
            int y,
            int w,
            int h
    ) {
        return Slot.chart(chartType, title, datasetId, encode, x, y, w, h);
    }

    private static LinkDef link(String sourceTitle, String sourceField, String targetTitle, String targetField) {
        return new LinkDef(sourceTitle, sourceField, targetTitle, targetField);
    }

    private static Blueprint materialize(
            String dashboardId,
            LongSupplier idGen,
            String theme,
            String folder,
            List<Slot> slots,
            List<LinkDef> linkDefs
    ) {
        Map<String, ChartViewVO> charts = new LinkedHashMap<>();
        List<DashboardComponentVO> components = new ArrayList<>();
        Map<String, String> titleToChartId = new HashMap<>();
        int z = 1;
        for (Slot slot : slots) {
            String compId = String.valueOf(idGen.getAsLong());
            if (slot.isQuery()) {
                Map<String, Object> props = new HashMap<>(slot.props);
                props.put("tabId", "tab_main");
                components.add(new DashboardComponentVO(
                        compId, "query", "0", null,
                        slot.x * GRID_SCALE, slot.y * GRID_SCALE, slot.w * GRID_SCALE, slot.h * GRID_SCALE,
                        z++,
                        props
                ));
                continue;
            }
            String chartId = String.valueOf(idGen.getAsLong());
            Map<String, Object> encode = new HashMap<>(slot.encode);
            encode.put("datasetId", slot.datasetId);
            charts.put(chartId, new ChartViewVO(
                    chartId, dashboardId, slot.datasetId, slot.chartType, slot.title,
                    encode, Map.of(), Map.of()
            ));
            titleToChartId.put(slot.title, chartId);
            components.add(new DashboardComponentVO(
                    compId, "chart", "0", chartId,
                    slot.x * GRID_SCALE, slot.y * GRID_SCALE, slot.w * GRID_SCALE, slot.h * GRID_SCALE,
                    z++,
                    Map.of("tabId", "tab_main")
            ));
        }

        List<DashboardLinkageVO> linkages = new ArrayList<>();
        for (LinkDef ld : linkDefs) {
            String src = titleToChartId.get(ld.sourceTitle());
            String tgt = titleToChartId.get(ld.targetTitle());
            if (src == null || tgt == null) continue;
            linkages.add(new DashboardLinkageVO(
                    String.valueOf(idGen.getAsLong()),
                    src,
                    ld.sourceField(),
                    tgt,
                    ld.targetField(),
                    true
            ));
        }

        Map<String, Object> extStyle = new HashMap<>();
        extStyle.put("theme", theme);
        extStyle.put("folder", folder);
        extStyle.put("tabs", List.of(Map.of("id", "tab_main", "name", "概览")));
        extStyle.put("activeTab", "tab_main");
        return new Blueprint(components, charts, extStyle, linkages);
    }

    private record LinkDef(String sourceTitle, String sourceField, String targetTitle, String targetField) {}

    private static final class Slot {
        final String kind; // chart | query
        final String chartType;
        final String title;
        final String datasetId;
        final Map<String, Object> encode;
        final Map<String, Object> props;
        final int x;
        final int y;
        final int w;
        final int h;

        private Slot(
                String kind,
                String chartType,
                String title,
                String datasetId,
                Map<String, Object> encode,
                Map<String, Object> props,
                int x,
                int y,
                int w,
                int h
        ) {
            this.kind = kind;
            this.chartType = chartType;
            this.title = title;
            this.datasetId = datasetId;
            this.encode = encode;
            this.props = props;
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
        }

        static Slot chart(
                String chartType,
                String title,
                String datasetId,
                Map<String, Object> encode,
                int x,
                int y,
                int w,
                int h
        ) {
            return new Slot("chart", chartType, title, datasetId, encode, Map.of(), x, y, w, h);
        }

        static Slot query(Map<String, Object> props, int x, int y, int w, int h) {
            return new Slot("query", null, null, null, Map.of(), props, x, y, w, h);
        }

        boolean isQuery() {
            return "query".equals(kind);
        }
    }

    public record Blueprint(
            List<DashboardComponentVO> components,
            Map<String, ChartViewVO> charts,
            Map<String, Object> extStyle,
            List<DashboardLinkageVO> linkages
    ) {
        static Blueprint empty() {
            return new Blueprint(List.of(), Map.of(), Map.of(), List.of());
        }

        boolean isEmpty() {
            return components == null || components.isEmpty();
        }
    }
}
