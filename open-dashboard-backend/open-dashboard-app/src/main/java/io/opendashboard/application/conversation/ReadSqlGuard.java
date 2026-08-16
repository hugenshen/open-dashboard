package io.opendashboard.application.conversation;

import java.util.Locale;
import java.util.regex.Pattern;

/** Second-line gate for SQLBot Ask-3. Primary parse/table check lives in harness sqlglot. */
public final class ReadSqlGuard {

    private static final Pattern COMMENT_LINE = Pattern.compile("--.*?$", Pattern.MULTILINE);
    private static final Pattern COMMENT_BLOCK = Pattern.compile("/\\*.*?\\*/", Pattern.DOTALL);
    private static final Pattern WRITE = Pattern.compile(
            "(?i)\\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|MERGE|COPY|REPLACE|CALL|SET|USE)\\b"
    );

    private ReadSqlGuard() {}

    public static String requireSelect(String sql) {
        if (sql == null || sql.isBlank()) {
            throw new IllegalArgumentException("SQL 为空");
        }
        String stripped = COMMENT_BLOCK.matcher(COMMENT_LINE.matcher(sql).replaceAll("")).replaceAll("").trim();
        if (stripped.endsWith(";")) stripped = stripped.substring(0, stripped.length() - 1).trim();
        if (stripped.contains(";")) {
            throw new IllegalArgumentException("只允许单条 SELECT");
        }
        String first = stripped.split("\\s+", 2)[0].toUpperCase(Locale.ROOT);
        if (!"SELECT".equals(first) && !"WITH".equals(first) && !"(".equals(first)) {
            throw new IllegalArgumentException("只允许 SELECT / WITH");
        }
        if (WRITE.matcher(stripped).find()) {
            throw new IllegalArgumentException("禁止写操作 SQL");
        }
        return stripped;
    }
}
