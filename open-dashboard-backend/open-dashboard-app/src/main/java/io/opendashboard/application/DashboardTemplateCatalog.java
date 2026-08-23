package io.opendashboard.application;

import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentVO;
import io.opendashboard.domain.DashboardDtos.DashboardLinkageVO;
import io.opendashboard.domain.DashboardDtos.DashboardTemplateVO;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Built-in dashboard page templates (P013).
 * Authored in 12-col hi-fi units and scaled ×6 onto the product 72-col grid.
 */
public final class DashboardTemplateCatalog {

    private static final int GRID_SCALE = 6;

    private DashboardTemplateCatalog() {}

    private static final List<DashboardTemplateVO> TEMPLATES = List.of(
            meta("blank", "空白画布", "空白", "通用", "从空画布开始，移动端按 P001 C 档手排", false, false),
            meta("exec", "经营驾驶舱", "推荐", "经营", "管理层一屏：收入/利润/订单/履约", true, true),
            meta("kpi-wall", "KPI 墙", "推荐", "经营", "指标墙，适合晨会投屏", true, true),
            meta("hr", "人力编制", "推荐", "经营", "编制、到岗、流失与部门对比", true, true),
            meta("sales", "销售分析", "销售", "销售", "KPI + 区域/渠道/销售员，点击联动明细", true, true),
            meta("region", "区域作战", "销售", "销售", "城市与仓配视角", true, true),
            meta("channel", "渠道对比", "销售", "销售", "线上线下渠道成交结构", false, true),
            meta("product", "产品贡献", "销售", "销售", "SKU / 品类贡献与趋势", false, true),
            meta("ops", "运营看板", "运营", "运营", "UV/PV/停留/跳出", true, true),
            meta("promo", "促销监控", "运营", "运营", "活动 GMV、折扣与冲刺榜", true, true),
            meta("funnel", "转化漏斗", "运营", "运营", "曝光→点击→下单漏斗", true, true),
            meta("traffic", "流量获客", "运营", "运营", "来源结构与端对比", false, true),
            meta("sla", "服务时效", "运营", "运营", "工单时效与满意度", false, true),
            meta("finance", "财务概览", "财务", "财务", "收支利润 + 科目联动", true, true),
            meta("cash", "现金流", "财务", "财务", "回款、支出与月度利润", true, true),
            meta("cost", "费用管控", "财务", "财务", "部门费用与科目结构", false, true),
            meta("gmv", "商户入账", "零售", "零售", "支付状态入账、商户类型对比", true, true),
            meta("store", "门店零售", "零售", "零售", "门店日销、客单与连带", true, true),
            meta("crm", "客户分层", "客户", "客户", "A/B/C 类保有与触达", true, true),
            meta("cohort", "留存分析", "客户", "客户", "新客留存与复购", false, true),
            meta("nps", "满意度", "客户", "客户", "NPS 与差评分布", false, true),
            meta("inventory", "库存周转", "供应", "供应", "仓配库存金额与周转天", true, true),
            meta("supply", "供应履约", "供应", "供应", "履约率、缺货与在途", true, true),
            meta("quality", "质量缺陷", "供应", "供应", "来料不良与退货", false, true)
    );

    public static List<DashboardTemplateVO> list() {
        return TEMPLATES;
    }

    public static String defaultName(String templateId) {
        String id = normalize(templateId);
        if ("blank".equals(id)) return null;
        return TEMPLATES.stream()
                .filter(t -> t.id().equals(id))
                .map(DashboardTemplateVO::name)
                .findFirst()
                .orElse(null);
    }

    public static String normalize(String templateId) {
        if (templateId == null || templateId.isBlank()) return "blank";
        String id = templateId.trim().toLowerCase();
        for (DashboardTemplateVO t : TEMPLATES) {
            if (t.id().equals(id)) return id;
        }
        return "blank";
    }

    public static Blueprint build(String templateId, String dashboardId, LongSupplier idGen) {
        String id = normalize(templateId);
        return switch (id) {
            case "blank" -> Blueprint.empty();
            case "sales" -> salesFamily(dashboardId, idGen, "region", "区域", null, "销售分析",
                    List.of("本月 GMV", "本月销量", "利润", "订单数"));
            case "region" -> salesFamily(dashboardId, idGen, "region", "区域", null, "区域作战",
                    List.of("区域 GMV", "覆盖城市", "门店数", "客单"));
            case "channel" -> salesFamily(dashboardId, idGen, "channel", "渠道", null, "渠道对比",
                    List.of("渠道 GMV", "线上", "线下", "转化"));
            case "product" -> salesFamily(dashboardId, idGen, "product", "产品", null, "产品贡献",
                    List.of("SKU GMV", "销量", "毛利", "动销"));
            case "gmv" -> salesFamily(dashboardId, idGen, "channel", "渠道", null, "商户入账",
                    List.of("入账 GMV", "成功率", "商户数", "客单"));
            case "store" -> salesFamily(dashboardId, idGen, "region", "区域", "门店零售 · 日销 / 客流 / 连带", "门店零售",
                    List.of("日销", "客流", "连带", "库存"));
            case "exec" -> salesFamily(dashboardId, idGen, "region", "区域", "经营驾驶舱 · 收入 / 利润 / 订单 / 履约", "经营驾驶舱",
                    List.of("收入", "利润", "订单", "履约"));
            case "kpi-wall" -> salesFamily(dashboardId, idGen, "region", "区域", "KPI 墙 · 晨会投屏", "KPI 墙",
                    List.of("本月 GMV", "本月销量", "利润", "订单数"));
            case "hr" -> salesFamily(dashboardId, idGen, "salesman", "部门", "人力编制 · 编制 / 到岗 / 流失", "人力编制",
                    List.of("编制", "到岗", "流失", "绩效"));
            case "crm" -> salesFamily(dashboardId, idGen, "salesman", "客户经理", null, "客户分层",
                    List.of("A 类客户", "B 类", "复购", "触达"));
            case "cohort" -> salesFamily(dashboardId, idGen, "salesman", "队列", null, "留存分析",
                    List.of("新客", "留存", "复购", "流失"));
            case "nps" -> salesFamily(dashboardId, idGen, "channel", "渠道", null, "满意度",
                    List.of("NPS", "好评", "差评", "响应"));
            case "inventory" -> salesFamily(dashboardId, idGen, "product", "产品", null, "库存周转",
                    List.of("库存额", "周转天", "缺货", "滞销"));
            case "supply" -> salesFamily(dashboardId, idGen, "product", "产品", null, "供应履约",
                    List.of("履约率", "在途", "缺货", "及时率"));
            case "quality" -> salesFamily(dashboardId, idGen, "product", "产品", null, "质量缺陷",
                    List.of("不良率", "退货", "来料", "客诉"));
            case "ops" -> opsFamily(dashboardId, idGen, "module", "模块", null, "运营增长",
                    List.of("周 UV", "周 PV", "均停留秒", "跳出率"));
            case "promo" -> opsFamily(dashboardId, idGen, "channel", "来源", null, "促销监控",
                    List.of("活动 UV", "活动 PV", "转化", "跳出"));
            case "funnel" -> opsFamily(dashboardId, idGen, "channel", "来源", null, "转化漏斗",
                    List.of("曝光", "点击", "下单", "支付"));
            case "traffic" -> opsFamily(dashboardId, idGen, "platform", "端", null, "流量获客",
                    List.of("UV", "PV", "新客", "跳出"));
            case "sla" -> opsFamily(dashboardId, idGen, "module", "模块", null, "服务时效",
                    List.of("及时率", "响应", "满意度", "工单"));
            case "finance" -> financeFamily(dashboardId, idGen, "subject", "科目", null, "财务库存",
                    List.of("累计收入", "累计支出", "累计利润"));
            case "cash" -> financeFamily(dashboardId, idGen, "month", "月份", null, "现金流",
                    List.of("回款", "支出", "净现金流"));
            case "cost" -> financeFamily(dashboardId, idGen, "dept", "部门", null, "费用管控",
                    List.of("费用", "预算占用", "超支"));
            default -> Blueprint.empty();
        };
    }

    private static DashboardTemplateVO meta(
            String id, String name, String category, String domain, String description,
            boolean recommended, boolean responsive
    ) {
        return new DashboardTemplateVO(id, name, domain, description, category, null, responsive, recommended);
    }

    private static Blueprint salesFamily(
            String dashboardId, LongSupplier idGen, String dim, String dimLabel,
            String hero, String folder, List<String> kpis
    ) {
        int y0 = hero != null ? 2 : 0;
        List<Slot> slots = new ArrayList<>();
        if (hero != null) slots.add(heroBanner(hero, 0, 0));
        slots.add(queryBar(List.of(dateRangeItem(), selectItem(dim, dimLabel)), 0, y0));
        slots.add(chart("kpi", kpis.get(0), "ds_sales", enc("amount", "SUM"), 0, y0 + 1, 3, 2));
        slots.add(chart("kpi", kpis.get(1), "ds_sales", enc("qty", "SUM"), 3, y0 + 1, 3, 2));
        slots.add(chart("kpi", kpis.get(2), "ds_sales", enc("profit", "SUM"), 6, y0 + 1, 3, 2));
        slots.add(chart("kpi", kpis.get(3), "ds_sales", enc("order_cnt", "SUM"), 9, y0 + 1, 3, 2));
        slots.add(chart("bar", "区域销售额", "ds_sales", enc("region", "amount", "SUM"), 0, y0 + 3, 6, 5));
        slots.add(chart("line", "产品销售趋势", "ds_sales", enc("product", "amount", "SUM"), 6, y0 + 3, 6, 5));
        slots.add(chart("hbar", "销售员业绩", "ds_sales", enc("salesman", "amount", "SUM"), 0, y0 + 8, 4, 4));
        slots.add(chart("pie", "渠道占比", "ds_sales", enc("channel", "amount", "SUM"), 4, y0 + 8, 4, 4));
        slots.add(chart("area", "产品贡献", "ds_sales", enc("product", "qty", "SUM"), 8, y0 + 8, 4, 4));
        slots.add(chart("grouptable", "销售员汇总", "ds_sales", enc("salesman", "amount", "SUM"), 0, y0 + 12, 6, 4));
        slots.add(chart("table", "销售明细", "ds_sales", encRaw("amount"), 6, y0 + 12, 6, 4));
        slots.add(chart("bar", "渠道销售额", "ds_sales", enc("channel", "amount", "SUM"), 0, y0 + 16, 6, 4));
        slots.add(chart("line", "区域销量趋势", "ds_sales", enc("region", "qty", "SUM"), 6, y0 + 16, 6, 4));
        return materialize(
                dashboardId, idGen, "default", folder, slots,
                List.of(
                        link("区域销售额", "region", "销售明细", "region"),
                        link("区域销售额", "region", "销售员汇总", "region"),
                        link("区域销售额", "region", "产品销售趋势", "region"),
                        link("渠道占比", "channel", "销售明细", "channel"),
                        link("渠道占比", "channel", "渠道销售额", "channel")
                ),
                true
        );
    }

    private static Blueprint opsFamily(
            String dashboardId, LongSupplier idGen, String dim, String dimLabel,
            String hero, String folder, List<String> kpis
    ) {
        int y0 = hero != null ? 2 : 0;
        List<Slot> slots = new ArrayList<>();
        if (hero != null) slots.add(heroBanner(hero, 0, 0));
        slots.add(queryBar(List.of(dateRangeItem(), selectItem(dim, dimLabel)), 0, y0));
        slots.add(chart("kpi", kpis.get(0), "ds_ops", enc("uv", "SUM"), 0, y0 + 1, 3, 2));
        slots.add(chart("kpi", kpis.get(1), "ds_ops", enc("pv", "SUM"), 3, y0 + 1, 3, 2));
        slots.add(chart("kpi", kpis.get(2), "ds_ops", enc("duration", "AVG"), 6, y0 + 1, 3, 2));
        slots.add(chart("kpi", kpis.get(3), "ds_ops", enc("bounce", "AVG"), 9, y0 + 1, 3, 2));
        slots.add(chart("area", "每日 UV 走势", "ds_ops", enc("day", "uv", "SUM"), 0, y0 + 3, 8, 5));
        slots.add(chart("pie", "来源结构", "ds_ops", enc("channel", "uv", "SUM"), 8, y0 + 3, 4, 5));
        slots.add(chart("line", "每日 PV 走势", "ds_ops", enc("day", "pv", "SUM"), 0, y0 + 8, 6, 4));
        slots.add(chart("hbar", "端 UV 对比", "ds_ops", enc("platform", "uv", "SUM"), 6, y0 + 8, 6, 4));
        slots.add(chart("bar", "模块流量", "ds_ops", enc("module", "pv", "SUM"), 0, y0 + 12, 5, 4));
        slots.add(chart("grouptable", "模块汇总", "ds_ops", enc("module", "uv", "SUM"), 5, y0 + 12, 7, 4));
        slots.add(chart("table", "流量明细", "ds_ops", encRaw("uv"), 0, y0 + 16, 7, 4));
        slots.add(chart("pie", "端占比", "ds_ops", enc("platform", "pv", "SUM"), 7, y0 + 16, 5, 4));
        return materialize(
                dashboardId, idGen, "ocean", folder, slots,
                List.of(
                        link("模块流量", "module", "流量明细", "module"),
                        link("模块流量", "module", "模块汇总", "module"),
                        link("来源结构", "channel", "流量明细", "channel"),
                        link("端 UV 对比", "platform", "流量明细", "platform"),
                        link("端占比", "platform", "每日 UV 走势", "platform")
                ),
                true
        );
    }

    private static Blueprint financeFamily(
            String dashboardId, LongSupplier idGen, String dim, String dimLabel,
            String hero, String folder, List<String> kpis
    ) {
        int y0 = hero != null ? 2 : 0;
        List<Slot> slots = new ArrayList<>();
        if (hero != null) slots.add(heroBanner(hero, 0, 0));
        slots.add(queryBar(List.of(dateRangeItem(), selectItem(dim, dimLabel)), 0, y0));
        slots.add(chart("kpi", kpis.get(0), "ds_fin", enc("income", "SUM"), 0, y0 + 1, 4, 2));
        slots.add(chart("kpi", kpis.get(1), "ds_fin", enc("expense", "SUM"), 4, y0 + 1, 4, 2));
        slots.add(chart("kpi", kpis.get(2), "ds_fin", enc("profit", "SUM"), 8, y0 + 1, 4, 2));
        slots.add(chart("line", "月度收入", "ds_fin", enc("month", "income", "SUM"), 0, y0 + 3, 6, 4));
        slots.add(chart("area", "月度支出", "ds_fin", enc("month", "expense", "SUM"), 6, y0 + 3, 6, 4));
        slots.add(chart("bar", "科目支出结构", "ds_fin", enc("subject", "expense", "SUM"), 0, y0 + 7, 5, 4));
        slots.add(chart("hbar", "部门利润", "ds_fin", enc("dept", "profit", "SUM"), 5, y0 + 7, 4, 4));
        slots.add(chart("pie", "科目收入占比", "ds_fin", enc("subject", "income", "SUM"), 9, y0 + 7, 3, 4));
        slots.add(chart("grouptable", "科目汇总", "ds_fin", enc("subject", "expense", "SUM"), 0, y0 + 11, 5, 4));
        slots.add(chart("table", "科目明细", "ds_fin", encRaw("profit"), 5, y0 + 11, 7, 4));
        slots.add(chart("bar", "部门收入", "ds_fin", enc("dept", "income", "SUM"), 0, y0 + 15, 6, 4));
        slots.add(chart("line", "月度利润", "ds_fin", enc("month", "profit", "SUM"), 6, y0 + 15, 6, 4));
        return materialize(
                dashboardId, idGen, "default", folder, slots,
                List.of(
                        link("科目支出结构", "subject", "科目明细", "subject"),
                        link("科目支出结构", "subject", "科目汇总", "subject"),
                        link("科目收入占比", "subject", "科目明细", "subject"),
                        link("部门利润", "dept", "科目明细", "dept"),
                        link("部门收入", "dept", "月度利润", "dept")
                ),
                true
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

    private static Map<String, Object> dateRangeItem() {
        Map<String, Object> m = new HashMap<>();
        m.put("id", "qf_date");
        m.put("kind", "dateRange");
        m.put("field", "date");
        m.put("label", "日期");
        m.put("scope", "all");
        m.put("targetChartIds", List.of());
        return m;
    }

    private static Map<String, Object> selectItem(String field, String label) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", "qf_" + field);
        m.put("kind", "select");
        m.put("field", field);
        m.put("label", label);
        m.put("scope", "all");
        m.put("targetChartIds", List.of());
        return m;
    }

    private static Slot queryBar(List<Map<String, Object>> items, int x, int y) {
        Map<String, Object> props = new HashMap<>();
        props.put("label", "查询条件");
        props.put("items", items);
        props.put("align", "center");
        return Slot.query(props, x, y, 12, 1);
    }

    private static Slot heroBanner(String content, int x, int y) {
        Map<String, Object> props = new HashMap<>();
        props.put("content", content);
        props.put("fontSize", 22);
        props.put("color", "#ffffff");
        props.put("bg", "linear-gradient(135deg,#6d5efc,#ff7a59 52%,#3ec8ff)");
        props.put("align", "left");
        return Slot.text(props, x, y, 12, 2);
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
            List<LinkDef> linkDefs,
            boolean seedMobile
    ) {
        Map<String, ChartViewVO> charts = new LinkedHashMap<>();
        List<DashboardComponentVO> components = new ArrayList<>();
        Map<String, String> titleToChartId = new HashMap<>();
        int z = 1;
        for (Slot slot : slots) {
            String compId = String.valueOf(idGen.getAsLong());
            if (slot.isQuery() || slot.isText()) {
                Map<String, Object> props = new HashMap<>(slot.props);
                props.put("tabId", "tab_main");
                components.add(new DashboardComponentVO(
                        compId, slot.kind, "0", null,
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
        Map<String, Object> mobile = seedMobile ? seedMobileLayout(components, charts) : Map.of();
        return new Blueprint(components, charts, extStyle, linkages, mobile);
    }

    private static Map<String, Object> seedMobileLayout(
            List<DashboardComponentVO> components,
            Map<String, ChartViewVO> charts
    ) {
        List<DashboardComponentVO> sorted = new ArrayList<>(components);
        sorted.sort(Comparator.comparingInt(DashboardComponentVO::y).thenComparingInt(DashboardComponentVO::x));
        List<Map<String, Object>> mobileComps = new ArrayList<>();
        int y = 0;
        int kpiX = 0;
        int z = 1;
        for (DashboardComponentVO c : sorted) {
            boolean kpi = false;
            if ("chart".equals(c.type()) && c.chartViewId() != null) {
                ChartViewVO ch = charts.get(c.chartViewId());
                kpi = ch != null && "kpi".equals(ch.chartType());
            }
            int mx;
            int mw;
            int mh;
            if ("query".equals(c.type()) || "slicer".equals(c.type()) || "text".equals(c.type())) {
                if (kpiX != 0) {
                    y += 2;
                    kpiX = 0;
                }
                mx = 0;
                mw = 6;
                mh = "text".equals(c.type()) && c.h() >= 12 ? 2 : 1;
            } else if (kpi) {
                mw = 3;
                mh = 2;
                mx = kpiX;
            } else {
                if (kpiX != 0) {
                    y += 2;
                    kpiX = 0;
                }
                mx = 0;
                mw = 6;
                mh = 4;
            }
            Map<String, Object> mc = new LinkedHashMap<>();
            mc.put("id", "m_" + c.id());
            mc.put("refId", c.id());
            mc.put("x", mx);
            mc.put("y", y);
            mc.put("w", mw);
            mc.put("h", mh);
            mc.put("z", z++);
            mc.put("styleSync", true);
            mobileComps.add(mc);
            if (kpi) {
                if (kpiX == 0) {
                    kpiX = 3;
                } else {
                    kpiX = 0;
                    y += 2;
                }
            } else {
                y += mh;
            }
        }
        if (kpiX != 0) {
            y += 2;
        }
        Map<String, Object> mobile = new LinkedHashMap<>();
        mobile.put("enabled", true);
        mobile.put("device", "iphone-14");
        mobile.put("bg", "#f5f6f8");
        mobile.put("components", mobileComps);
        return mobile;
    }

    private record LinkDef(String sourceTitle, String sourceField, String targetTitle, String targetField) {}

    private static final class Slot {
        final String kind;
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

        static Slot text(Map<String, Object> props, int x, int y, int w, int h) {
            return new Slot("text", null, null, null, Map.of(), props, x, y, w, h);
        }

        boolean isQuery() {
            return "query".equals(kind);
        }

        boolean isText() {
            return "text".equals(kind);
        }
    }

    public record Blueprint(
            List<DashboardComponentVO> components,
            Map<String, ChartViewVO> charts,
            Map<String, Object> extStyle,
            List<DashboardLinkageVO> linkages,
            Map<String, Object> mobile
    ) {
        static Blueprint empty() {
            return new Blueprint(List.of(), Map.of(), Map.of(), List.of(), Map.of());
        }

        boolean isEmpty() {
            return components == null || components.isEmpty();
        }
    }
}
