package io.opendashboard.application.conversation;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Structural field-role hints from name/label (not a business dictionary).
 * IDs and code-like enums are often stored as DECIMAL and must not be SUM'd.
 */
public final class FieldSemantics {

    private static final Pattern ENUM_PAIR = Pattern.compile("(-?\\d+)\\s*[-:：]\\s*([^,;，]+)");
    private static final Pattern ID_NAME = Pattern.compile(
            "(?i)(^id$|id$|_id$|_no$|no$|uuid$|guid$|orderid$|userid$|mchid$)"
    );

    private FieldSemantics() {}

    public static boolean queryFailed(String sql) {
        if (sql == null || sql.isBlank()) return false;
        String s = sql.toLowerCase(Locale.ROOT);
        return s.contains("unavailable") || s.contains("live query failed")
                || s.contains("timeout") || s.contains("timed out") || s.contains("timed-out");
    }

    public static boolean looksLikeMeasureName(String name, String label) {
        String blob = blob(name, label);
        return blob.matches("(?s).*(金额|入账|利润|成本|数量|笔数|费率|销售额|收入|amount|income|profit|qty|count|fee|rate).*");
    }

    public static boolean looksLikeIdentifier(String name, String label) {
        if (looksLikeMeasureName(name, label)) return false;
        String n = name == null ? "" : name.trim();
        String l = label == null ? "" : label.trim();
        if (!n.isEmpty() && ID_NAME.matcher(n).find()) return true;
        String head = l.replace('，', ',');
        int comma = head.indexOf(',');
        if (comma > 0) head = head.substring(0, comma).trim();
        if (head.matches(".*(ID|Id)$") || head.endsWith("号") || head.endsWith("编号")) {
            return !head.contains("类型") && !head.contains("状态");
        }
        return false;
    }

    public static boolean looksLikeCodeDim(String name, String label) {
        if (looksLikeMeasureName(name, label)) return false;
        if (looksLikeIdentifier(name, label)) return false;
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        String lab = label == null ? "" : label;
        if (n.equals("status") || n.endsWith("status") || n.endsWith("type") || n.endsWith("code")) {
            return true;
        }
        return lab.matches(".*(类型|状态|渠道|方式|等级).*")
                && !lab.matches(".*(金额|费率|收入|数量|笔数|合计).*");
    }

    public static boolean looksLikeRatio(String name, String label) {
        String blob = blob(name, label).toLowerCase(Locale.ROOT);
        return blob.contains("费率") || blob.contains("占比") || blob.contains("比例")
                || blob.contains("rate") || blob.contains("ratio") || blob.contains("percent")
                || blob.contains("利润率")
                || (blob.contains("率") && !blob.contains("利润"));
    }

    /**
     * Parse {@code 支付状态,0-订单生成,2-支付成功} comment enumerations into code → label.
     */
    public static Map<String, String> parseValueMap(String label) {
        if (label == null || label.isBlank()) return Map.of();
        Matcher m = ENUM_PAIR.matcher(label.replace('，', ','));
        Map<String, String> out = new LinkedHashMap<>();
        while (m.find()) {
            out.put(m.group(1), m.group(2).trim());
        }
        return out.size() >= 2 ? Map.copyOf(out) : Map.of();
    }

    private static String blob(String name, String label) {
        return (name == null ? "" : name) + " " + (label == null ? "" : label);
    }
}
