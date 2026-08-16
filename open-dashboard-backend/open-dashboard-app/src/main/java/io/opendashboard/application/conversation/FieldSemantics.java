package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;

import java.util.Locale;

/**
 * Shared field roles: keep business entity IDs (MchId) as dims, junk order-nos / bare PKs.
 */
public final class FieldSemantics {

    private FieldSemantics() {}

    public static boolean isBusinessEntityId(DatasetFieldVO f) {
        if (f == null || f.name() == null) return false;
        String n = f.name().toLowerCase(Locale.ROOT);
        String l = f.label() == null ? "" : f.label();
        if (n.equals("id") || n.equals("uuid") || n.equals("pid") || n.equals("version")) return false;
        if (n.contains("orderno") || n.contains("order_no") || n.contains("appid")) return false;
        if (n.contains("order") && (n.contains("id") || n.endsWith("no"))) return false;
        boolean idLike = n.endsWith("id") || l.contains("ID") || l.contains("编号");
        if (!idLike) return false;
        return n.contains("mch") || n.contains("merchant") || n.contains("shop") || n.contains("store")
                || n.contains("agent")
                || l.contains("商户") || l.contains("商家") || l.contains("门店") || l.contains("代理");
    }

    public static boolean looksDim(DatasetFieldVO f) {
        if (f == null || f.name() == null) return false;
        String n = f.name().toLowerCase(Locale.ROOT);
        if (n.contains("url") || n.contains("msg")) return false;
        if (n.contains("orderno") || n.contains("order_no")) return false;
        if (n.endsWith("id")) return isBusinessEntityId(f);
        return true;
    }

    public static boolean looksIncomeMeasure(String field) {
        if (field == null || field.isBlank()) return false;
        String n = field.toLowerCase(Locale.ROOT);
        return n.contains("income") || n.contains("profit") || n.contains("入账") || n.contains("收入");
    }

    public static boolean queryFailed(String sql) {
        if (sql == null || sql.isBlank()) return false;
        String s = sql.toLowerCase(Locale.ROOT);
        return s.contains("unavailable") || s.contains("live query failed")
                || s.contains("timeout") || s.contains("timed out") || s.contains("timed-out");
    }

    public static String findAmountFallback(Iterable<DatasetFieldVO> fields, String currentValue) {
        if (fields == null) return null;
        String cur = currentValue == null ? "" : currentValue;
        String secondary = null;
        for (DatasetFieldVO f : fields) {
            if (f == null || f.name() == null) continue;
            if (f.name().equalsIgnoreCase(cur)) continue;
            String n = f.name().toLowerCase(Locale.ROOT);
            String l = f.label() == null ? "" : f.label();
            boolean amount = n.contains("amount") || l.contains("金额") || l.contains("销售额");
            if (!amount) continue;
            if (n.contains("refund") || n.contains("actual") || l.contains("退款")) {
                if (secondary == null) secondary = f.name();
                continue;
            }
            return f.name();
        }
        return secondary;
    }
}
