package io.opendashboard.application.conversation;

/**
 * Query error strings only. Field roles come from learned profile or schema group/type.
 */
public final class FieldSemantics {

    private FieldSemantics() {}

    public static boolean queryFailed(String sql) {
        if (sql == null || sql.isBlank()) return false;
        String s = sql.toLowerCase();
        return s.contains("unavailable") || s.contains("live query failed")
                || s.contains("timeout") || s.contains("timed out") || s.contains("timed-out");
    }
}
