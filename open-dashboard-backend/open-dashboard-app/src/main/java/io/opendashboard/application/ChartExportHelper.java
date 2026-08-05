package io.opendashboard.application;

import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import io.opendashboard.domain.QueryDtos.FieldMeta;

import java.nio.charset.StandardCharsets;
import java.util.List;

/** 通用图表结果 → CSV（带 BOM，Excel 可直接打开） */
public final class ChartExportHelper {

    private ChartExportHelper() {}

    public static byte[] toCsvBytes(ChartQueryResult result) {
        return toCsv(result).getBytes(StandardCharsets.UTF_8);
    }

    public static String toCsv(ChartQueryResult result) {
        StringBuilder sb = new StringBuilder();
        // UTF-8 BOM
        sb.append('\uFEFF');
        List<FieldMeta> fields = result.fields() == null ? List.of() : result.fields();
        List<List<Object>> data = result.data() == null ? List.of() : result.data();

        if (!fields.isEmpty()) {
            for (int i = 0; i < fields.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append(csvEscape(fields.get(i).name()));
            }
            sb.append('\n');
            for (List<Object> row : data) {
                for (int i = 0; i < fields.size(); i++) {
                    if (i > 0) sb.append(',');
                    Object v = row != null && i < row.size() ? row.get(i) : "";
                    sb.append(csvEscape(v == null ? "" : String.valueOf(v)));
                }
                sb.append('\n');
            }
            return sb.toString();
        }

        // series fallback
        Object series = result.series();
        if (series instanceof java.util.Map<?, ?> map) {
            Object cats = map.get("categories");
            Object seriesArr = map.get("series");
            if (cats instanceof List<?> categories && seriesArr instanceof List<?> seriesList) {
                sb.append(csvEscape("name"));
                for (Object s : seriesList) {
                    if (s instanceof java.util.Map<?, ?> sm) {
                        Object name = sm.get("name");
                        sb.append(',').append(csvEscape(String.valueOf(name == null ? "value" : name)));
                    }
                }
                sb.append('\n');
                for (int i = 0; i < categories.size(); i++) {
                    sb.append(csvEscape(String.valueOf(categories.get(i))));
                    for (Object s : seriesList) {
                        sb.append(',');
                        if (s instanceof java.util.Map<?, ?> sm) {
                            Object dataObj = sm.get("data");
                            if (dataObj instanceof List<?> dl && i < dl.size()) {
                                sb.append(csvEscape(String.valueOf(dl.get(i))));
                            }
                        }
                    }
                    sb.append('\n');
                }
                return sb.toString();
            }
            if (map.get("kpi") != null) {
                Object label = map.get("label");
                sb.append("label,kpi\n");
                sb.append(csvEscape(String.valueOf(label == null ? "kpi" : label))).append(',')
                        .append(csvEscape(String.valueOf(map.get("kpi")))).append('\n');
                return sb.toString();
            }
        }
        return sb.append("empty\n").toString();
    }

    private static String csvEscape(String s) {
        if (s == null) return "\"\"";
        boolean needQuote = s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r");
        String escaped = s.replace("\"", "\"\"");
        return needQuote ? "\"" + escaped + "\"" : escaped;
    }
}
