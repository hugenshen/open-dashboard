package io.opendashboard.infrastructure.datasource;

import io.opendashboard.domain.DatasourceDtos.ColumnItem;
import io.opendashboard.domain.DatasourceDtos.TableItem;
import io.opendashboard.domain.QueryDtos.ColumnMeta;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.datasource.ConnectionSpec;
import io.opendashboard.domain.gateway.DataSourcePort;
import io.opendashboard.domain.gateway.DataSourcePort.Agg;
import io.opendashboard.domain.gateway.DataSourcePort.PingResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.regex.Pattern;

/**
 * JDBC connector for MySQL / PostgreSQL: ping, catalogs, schemas, tables, columns, preview, execute.
 */
@Component
public class JdbcDataSourcePort implements DataSourcePort {


    private static final Pattern IDENT = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*$");
    /** Default row cap for live queries — avoid unbounded full-table fetches. */
    private static final int DEFAULT_QUERY_LIMIT = 1000;
    private static final int HARD_MAX_ROWS = 5000;
    private static final Pattern HAS_TRAILING_LIMIT = Pattern.compile(
            "(?is)\\blimit\\s+\\d+(\\s*,\\s*\\d+)?(\\s+offset\\s+\\d+)?\\s*$"
    );

    private final int queryTimeoutSec;
    /** When estimated table rows exceed this, aggregate over a sample subquery (not full scan). */
    private final long aggSampleThreshold;
    /** Inner LIMIT for sample-then-aggregate on large tables. */
    private final int aggSampleRows;
    private final LiveQueryGuard liveQueries;
    private final java.util.concurrent.ScheduledExecutorService cancelWatch =
            java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "od-jdbc-cancel-watch");
                t.setDaemon(true);
                return t;
            });

    public JdbcDataSourcePort(
            @Value("${opendashboard.query.timeout-sec:15}") int queryTimeoutSec,
            @Value("${opendashboard.query.agg-sample-threshold:100000}") long aggSampleThreshold,
            @Value("${opendashboard.query.agg-sample-rows:50000}") int aggSampleRows,
            LiveQueryGuard liveQueries
    ) {
        this.queryTimeoutSec = Math.max(3, queryTimeoutSec);
        this.aggSampleThreshold = Math.max(0L, aggSampleThreshold);
        this.aggSampleRows = Math.max(0, aggSampleRows);
        this.liveQueries = liveQueries;
    }

    public PingResult ping(ConnectionSpec spec) {
        long start = System.currentTimeMillis();
        try (Connection c = open(spec)) {
            try (Statement st = c.createStatement()) {
                st.setQueryTimeout(Math.min(8, queryTimeoutSec));
                st.execute("SELECT 1");
            }
            return new PingResult(true, "连接成功", System.currentTimeMillis() - start, null);
        } catch (Exception e) {
            return new PingResult(false, rootMessage(e), System.currentTimeMillis() - start, e.getClass().getSimpleName());
        }
    }

    public List<String> listDatabases(ConnectionSpec spec) {
        String type = spec.normalizedType();
        try (Connection c = open(spec.withDbName(bootstrapDb(spec)))) {
            List<String> out = new ArrayList<>();
            if ("postgresql".equals(type)) {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY 1")) {
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) out.add(rs.getString(1));
                    }
                }
            } else if ("mysql".equals(type)) {
                try (Statement st = c.createStatement();
                     ResultSet rs = st.executeQuery("SHOW DATABASES")) {
                    while (rs.next()) {
                        String name = rs.getString(1);
                        if (!isMysqlSystemDb(name)) out.add(name);
                    }
                }
            } else {
                throw unsupported(type);
            }
            return out;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("列举数据库失败: " + rootMessage(e), e);
        }
    }

    public List<String> listSchemas(ConnectionSpec spec) {
        requireDb(spec);
        String type = spec.normalizedType();
        try (Connection c = open(spec)) {
            List<String> out = new ArrayList<>();
            if ("postgresql".equals(type)) {
                try (PreparedStatement ps = c.prepareStatement(
                        """
                        SELECT schema_name FROM information_schema.schemata
                        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                        ORDER BY 1
                        """)) {
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) out.add(rs.getString(1));
                    }
                }
            } else if ("mysql".equals(type)) {
                // MySQL schema == database; still return current catalog for UI consistency
                String db = c.getCatalog();
                if (db != null && !db.isBlank()) out.add(db);
                else if (spec.dbName() != null) out.add(spec.dbName());
            } else {
                throw unsupported(type);
            }
            return out;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("列举 schema 失败: " + rootMessage(e), e);
        }
    }

    public List<TableItem> listTables(ConnectionSpec spec) {
        requireDb(spec);
        String type = spec.normalizedType();
        String schema = effectiveSchema(spec);
        try (Connection c = open(spec)) {
            List<TableItem> out = new ArrayList<>();
            DatabaseMetaData md = c.getMetaData();
            String catalog = "mysql".equals(type) ? spec.dbName() : c.getCatalog();
            try (ResultSet rs = md.getTables(catalog, schema, "%", new String[]{"TABLE", "VIEW"})) {
                while (rs.next()) {
                    String name = rs.getString("TABLE_NAME");
                    String remark = rs.getString("REMARKS");
                    String tableType = rs.getString("TABLE_TYPE");
                    String comment = remark != null && !remark.isBlank()
                            ? remark
                            : (tableType == null ? null : tableType.toLowerCase(Locale.ROOT));
                    out.add(new TableItem(name, comment));
                }
            }
            out.sort((a, b) -> a.name().compareToIgnoreCase(b.name()));
            return out;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("列举表失败: " + rootMessage(e), e);
        }
    }

    public List<ColumnItem> listColumns(ConnectionSpec spec, String table) {
        requireDb(spec);
        requireIdent(table, "表名");
        String type = spec.normalizedType();
        String schema = effectiveSchema(spec);
        try (Connection c = open(spec)) {
            List<ColumnItem> out = new ArrayList<>();
            DatabaseMetaData md = c.getMetaData();
            String catalog = "mysql".equals(type) ? spec.dbName() : c.getCatalog();
            try (ResultSet rs = md.getColumns(catalog, schema, table, "%")) {
                while (rs.next()) {
                    String name = rs.getString("COLUMN_NAME");
                    String typeName = rs.getString("TYPE_NAME");
                    String remark = rs.getString("REMARKS");
                    out.add(new ColumnItem(name, mapDataType(typeName), typeName, remark));
                }
            }
            return out;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("列举字段失败: " + rootMessage(e), e);
        }
    }

    public DatasetQueryResult previewTable(ConnectionSpec spec, String table, int limit) {
        requireDb(spec);
        requireIdent(table, "表名");
        int lim = clampLimit(limit, 50);
        String sql = "SELECT * FROM " + qualify(spec, table) + " LIMIT " + lim;
        return executeSql(spec, sql, lim);
    }

    /**
     * Simple aggregation / detail query for a physical table.
     * dimensions + measures → GROUP BY; otherwise SELECT columns or *.
     * Large tables: sample-then-aggregate so GROUP BY / COUNT does not full-scan.
     */
    public DatasetQueryResult queryTable(
            ConnectionSpec spec,
            String table,
            List<String> dimensions,
            List<Agg> measures,
            List<String> columns,
            Map<String, Object> filters,
            int limit
    ) {
        requireDb(spec);
        requireIdent(table, "表名");
        int lim = clampLimit(limit, DEFAULT_QUERY_LIMIT);
        String qTable = qualify(spec, table);
        String where = compileWhere(spec, filters);
        String sql;
        if (measures != null && !measures.isEmpty()) {
            List<String> outerSelect = new ArrayList<>();
            List<String> group = new ArrayList<>();
            List<String> sampleCols = new ArrayList<>();
            if (dimensions != null) {
                for (String d : dimensions) {
                    requireIdent(d, "维度字段");
                    String q = quote(spec, d);
                    outerSelect.add(q);
                    group.add(q);
                    if (!sampleCols.contains(q)) sampleCols.add(q);
                }
            }
            for (Agg m : measures) {
                requireIdent(m.field(), "指标字段");
                String q = quote(spec, m.field());
                String agg = normalizeAgg(m.agg());
                String alias = m.alias() == null || m.alias().isBlank() ? m.field() : m.alias();
                requireIdent(alias, "别名");
                if ("RAW".equals(agg)) outerSelect.add(q + " AS " + quote(spec, alias));
                else outerSelect.add(agg + "(" + q + ") AS " + quote(spec, alias));
                if (!sampleCols.contains(q)) sampleCols.add(q);
            }
            String from = qTable;
            long est = estimateTableRows(spec, table);
            boolean sample = shouldSampleAggregate(est);
            int sampleN = Math.max(1000, aggSampleRows);
            if (sample && !sampleCols.isEmpty()) {
                String inner = "SELECT " + String.join(", ", sampleCols) + " FROM " + qTable;
                if (!where.isBlank()) inner += " WHERE " + where;
                inner += " LIMIT " + sampleN;
                from = "(" + inner + ") _od_sample";
                where = ""; // already applied inside sample
            }
            sql = "SELECT " + String.join(", ", outerSelect) + " FROM " + from;
            if (!where.isBlank()) sql += " WHERE " + where;
            if (!group.isEmpty()) sql += " GROUP BY " + String.join(", ", group);
            sql += " LIMIT " + lim;
            if (sample) {
                sql = "/* od_sample est=" + est + " n=" + sampleN + " */ " + sql;
            }
            DatasetQueryResult raw = executeSql(spec, sql, lim);
            if (sample && est > sampleN) {
                double factor = (double) est / (double) sampleN;
                return scaleSampledAggregates(raw, measures, factor, est, sampleN);
            }
            return raw;
        } else if (columns != null && !columns.isEmpty()) {
            List<String> cols = new ArrayList<>();
            for (String col : columns) {
                requireIdent(col, "字段");
                cols.add(quote(spec, col));
            }
            sql = "SELECT " + String.join(", ", cols) + " FROM " + qTable;
            if (!where.isBlank()) sql += " WHERE " + where;
            sql += " LIMIT " + lim;
        } else {
            sql = "SELECT * FROM " + qTable;
            if (!where.isBlank()) sql += " WHERE " + where;
            sql += " LIMIT " + lim;
        }
        return executeSql(spec, sql, lim);
    }

    /**
     * Scale COUNT/SUM from a fixed-size sample toward estimated full-table totals.
     * AVG/MAX/MIN/RAW left unchanged. First-N sample is biased; this is preview-grade.
     */
    private static DatasetQueryResult scaleSampledAggregates(
            DatasetQueryResult raw,
            List<Agg> measures,
            double factor,
            long estRows,
            int sampleN
    ) {
        if (raw == null || raw.rows() == null || raw.rows().isEmpty() || factor <= 1.0) return raw;
        java.util.Set<String> scaleAliases = new java.util.HashSet<>();
        for (Agg m : measures) {
            String agg = normalizeAgg(m.agg());
            if (!"COUNT".equals(agg) && !"SUM".equals(agg)) continue;
            String alias = m.alias() == null || m.alias().isBlank() ? m.field() : m.alias();
            scaleAliases.add(alias.toLowerCase(Locale.ROOT));
        }
        if (scaleAliases.isEmpty()) return raw;
        List<ColumnMeta> cols = raw.columns() == null ? List.of() : raw.columns();
        List<Integer> idxs = new ArrayList<>();
        for (int i = 0; i < cols.size(); i++) {
            String name = cols.get(i).name();
            if (name != null && scaleAliases.contains(name.toLowerCase(Locale.ROOT))) idxs.add(i);
        }
        if (idxs.isEmpty()) return raw;
        List<List<Object>> scaled = new ArrayList<>(raw.rows().size());
        for (List<Object> row : raw.rows()) {
            if (row == null) {
                scaled.add(null);
                continue;
            }
            List<Object> copy = new ArrayList<>(row);
            for (int i : idxs) {
                if (i >= copy.size()) continue;
                Object v = copy.get(i);
                if (v instanceof Number n) {
                    double x = n.doubleValue() * factor;
                    // COUNT/SUM preview: round to long so chart series stay integer-ish
                    copy.set(i, Math.round(x));
                }
            }
            scaled.add(copy);
        }
        String base = raw.sql() == null ? "" : raw.sql();
        String sql = base
                + " /* scaled x" + String.format(Locale.ROOT, "%.3f", factor)
                + " est=" + estRows + " n=" + sampleN + " */";
        return new DatasetQueryResult(cols, scaled, raw.truncated(), sql, raw.elapsedMs());
    }

    private boolean shouldSampleAggregate(long estimatedRows) {
        if (aggSampleRows <= 0 || aggSampleThreshold <= 0) return false;
        // Unknown size (-1): still sample — safer for conversation / unknown warehouses.
        if (estimatedRows < 0) return true;
        return estimatedRows >= aggSampleThreshold;
    }

    /** Best-effort row estimate; -1 when unavailable. */
    long estimateTableRows(ConnectionSpec spec, String table) {
        try {
            String type = spec.normalizedType();
            try (Connection c = open(spec)) {
                if ("mysql".equals(type)) {
                    try (PreparedStatement ps = c.prepareStatement(
                            "SELECT TABLE_ROWS FROM information_schema.TABLES "
                                    + "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?")) {
                        ps.setString(1, spec.dbName());
                        ps.setString(2, table);
                        try (ResultSet rs = ps.executeQuery()) {
                            if (rs.next()) {
                                long n = rs.getLong(1);
                                return rs.wasNull() ? -1L : n;
                            }
                        }
                    }
                } else if ("postgresql".equals(type)) {
                    String schema = "public";
                    String name = table;
                    int dot = table.indexOf('.');
                    if (dot > 0) {
                        schema = table.substring(0, dot);
                        name = table.substring(dot + 1);
                    }
                    try (PreparedStatement ps = c.prepareStatement(
                            "SELECT COALESCE(c.reltuples, -1)::bigint FROM pg_class c "
                                    + "JOIN pg_namespace n ON n.oid = c.relnamespace "
                                    + "WHERE n.nspname = ? AND c.relname = ?")) {
                        ps.setString(1, schema);
                        ps.setString(2, name);
                        try (ResultSet rs = ps.executeQuery()) {
                            if (rs.next()) return rs.getLong(1);
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            return -1L;
        }
        return -1L;
    }

    /** Filter AST from encode.filters and chartQuery.context.filters (query-bar). */
    @SuppressWarnings("unchecked")
    private String compileWhere(ConnectionSpec spec, Map<String, Object> filters) {
        if (filters == null || filters.isEmpty()) return "";
        Object rawItems = filters.get("items");
        if (!(rawItems instanceof List<?> items) || items.isEmpty()) return "";
        List<String> parts = new ArrayList<>();
        boolean pg = "postgresql".equals(spec.normalizedType());
        for (Object it : items) {
            if (!(it instanceof Map<?, ?> m)) continue;
            String field = m.get("field") == null ? "" : String.valueOf(m.get("field"));
            Object opObj = m.get("op") != null ? m.get("op") : m.get("operator");
            String op = opObj == null ? "eq" : String.valueOf(opObj).toLowerCase(Locale.ROOT);
            if (field.isBlank()) continue;
            requireIdent(field, "过滤字段");
            String qf = quote(spec, field);
            if ("last".equals(op)) {
                int n = 1;
                Object nObj = m.get("n");
                if (nObj instanceof Number num) n = Math.max(1, num.intValue());
                else if (nObj != null) {
                    try { n = Math.max(1, Integer.parseInt(String.valueOf(nObj))); } catch (NumberFormatException ignored) {}
                }
                String unit = m.get("unit") == null ? "year" : String.valueOf(m.get("unit")).toLowerCase(Locale.ROOT);
                if (!unit.matches("year|month|day")) unit = "year";
                if (pg) {
                    parts.add(qf + " >= NOW() - INTERVAL '" + n + " " + unit + "'");
                } else {
                    String mysqlUnit = switch (unit) {
                        case "month" -> "MONTH";
                        case "day" -> "DAY";
                        default -> "YEAR";
                    };
                    parts.add(qf + " >= DATE_SUB(NOW(), INTERVAL " + n + " " + mysqlUnit + ")");
                }
            } else if ("between".equals(op) || "daterange".equals(op)) {
                Object from = m.get("from") != null ? m.get("from") : (m.get("value") instanceof List<?> p && !p.isEmpty() ? p.get(0) : null);
                Object to = m.get("to") != null ? m.get("to") : (m.get("value") instanceof List<?> p && p.size() > 1 ? p.get(1) : null);
                if (from != null && !String.valueOf(from).isBlank()) {
                    parts.add(qf + " >= " + sqlLiteral(from));
                }
                if (to != null && !String.valueOf(to).isBlank()) {
                    parts.add(qf + " <= " + sqlLiteral(to));
                }
            } else if ("in".equals(op) && m.get("value") instanceof List<?> vals) {
                List<String> lits = new ArrayList<>();
                for (Object v : vals) {
                    if (v != null && !String.valueOf(v).isBlank()) lits.add(sqlLiteral(v));
                }
                if (!lits.isEmpty()) parts.add(qf + " IN (" + String.join(", ", lits) + ")");
            } else if (m.get("value") != null && !String.valueOf(m.get("value")).isBlank()) {
                parts.add(qf + " = " + sqlLiteral(m.get("value")));
            }
        }
        return String.join(" AND ", parts);
    }

    public DatasetQueryResult executeSql(ConnectionSpec spec, String sql, int maxRows) {
        long start = System.currentTimeMillis();
        int lim = clampLimit(maxRows, DEFAULT_QUERY_LIMIT);
        String bounded = ensureLimit(sql, lim);
        liveQueries.acquire();
        String handleId = null;
        java.util.concurrent.ScheduledFuture<?> watchdog = null;
        try (Connection c = open(spec);
             Statement st = c.createStatement()) {
            applyServerQueryTimeout(c, spec);
            st.setQueryTimeout(queryTimeoutSec);
            st.setMaxRows(lim + 1);
            String owner = currentOwner();
            handleId = liveQueries.register(owner, st);
            final Statement cancelTarget = st;
            watchdog = cancelWatch.schedule(() -> {
                try {
                    if (!cancelTarget.isClosed()) cancelTarget.cancel();
                } catch (Exception ignored) {
                    // best-effort hard stop
                }
            }, queryTimeoutSec, java.util.concurrent.TimeUnit.SECONDS);
            try (ResultSet rs = st.executeQuery(bounded)) {
                ResultSetMetaData md = rs.getMetaData();
                int n = md.getColumnCount();
                List<ColumnMeta> cols = new ArrayList<>();
                for (int i = 1; i <= n; i++) {
                    String label = md.getColumnLabel(i);
                    cols.add(new ColumnMeta(label, mapDataType(md.getColumnTypeName(i)), label, null));
                }
                List<List<Object>> rows = new ArrayList<>();
                boolean truncated = false;
                while (rs.next()) {
                    if (rows.size() >= lim) {
                        truncated = true;
                        break;
                    }
                    List<Object> row = new ArrayList<>(n);
                    for (int i = 1; i <= n; i++) {
                        row.add(readCell(rs, i, md.getColumnType(i)));
                    }
                    rows.add(row);
                }
                return new DatasetQueryResult(cols, rows, truncated, bounded, System.currentTimeMillis() - start);
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            String msg = rootMessage(e);
            if (isTimeoutOrCancel(msg)) {
                throw new IllegalStateException("查询超时或已停止（≤" + queryTimeoutSec + "s）: " + msg, e);
            }
            throw new IllegalStateException("执行 SQL 失败: " + msg, e);
        } finally {
            if (watchdog != null) watchdog.cancel(false);
            liveQueries.unregister(handleId);
            liveQueries.release();
        }
    }

    /** MySQL max_execution_time / PG statement_timeout — kills work on the server, not only the driver. */
    private void applyServerQueryTimeout(Connection c, ConnectionSpec spec) {
        int ms = queryTimeoutSec * 1000;
        try (Statement st = c.createStatement()) {
            if ("mysql".equals(spec.normalizedType())) {
                // MySQL 5.7.8+: SELECT-only; unit is milliseconds.
                st.execute("SET SESSION max_execution_time = " + ms);
            } else if ("postgresql".equals(spec.normalizedType())) {
                st.execute("SET statement_timeout TO '" + ms + "ms'");
            }
        } catch (Exception ignored) {
            // older engines / permissions — JDBC timeout + watchdog still apply
        }
    }

    private static String currentOwner() {
        try {
            return io.opendashboard.domain.context.AuthContext.userIdOr("");
        } catch (Throwable t) {
            return "";
        }
    }

    private static boolean isTimeoutOrCancel(String msg) {
        if (msg == null) return false;
        String m = msg.toLowerCase(Locale.ROOT);
        return m.contains("timeout") || m.contains("timed out") || m.contains("cancel")
                || m.contains("interrupted") || m.contains("max_execution_time")
                || m.contains("statement_timeout") || m.contains("query execution was interrupted");
    }

    /** Append LIMIT when the statement has none, so the DB stops early on SELECT *. */
    static String ensureLimit(String sql, int lim) {
        String s = sql == null ? "" : sql.trim();
        if (s.endsWith(";")) s = s.substring(0, s.length() - 1).trim();
        if (s.isEmpty() || HAS_TRAILING_LIMIT.matcher(s).find()) return s;
        return s + " LIMIT " + lim;
    }

    public Connection open(ConnectionSpec spec) throws Exception {
        if (!spec.isJdbc()) throw unsupported(spec.normalizedType());
        if (spec.host() == null || spec.host().isBlank()) {
            throw new IllegalArgumentException("host 不能为空");
        }
        String type = spec.normalizedType();
        int port = spec.port() == null ? defaultPort(type) : spec.port();
        String url;
        if ("postgresql".equals(type)) {
            String db = blankTo(spec.dbName(), "postgres");
            url = "jdbc:postgresql://" + spec.host() + ":" + port + "/" + db;
            Class.forName("org.postgresql.Driver");
        } else if ("mysql".equals(type)) {
            String db = spec.dbName() == null ? "" : ("/" + spec.dbName());
            // characterEncoding must be a Java charset name (UTF-8); Connector/J maps it to utf8mb4.
            url = "jdbc:mysql://" + spec.host() + ":" + port + db
                    + "?useSSL=false&allowPublicKeyRetrieval=true&useUnicode=true"
                    + "&characterEncoding=UTF-8&connectionCollation=utf8mb4_unicode_ci"
                    + "&serverTimezone=UTC";
            Class.forName("com.mysql.cj.jdbc.Driver");
        } else {
            throw unsupported(type);
        }
        Properties props = new Properties();
        if (spec.username() != null) props.setProperty("user", spec.username());
        if (spec.password() != null) props.setProperty("password", spec.password());
        int loginSec = Math.min(8, queryTimeoutSec);
        props.setProperty("loginTimeout", String.valueOf(loginSec));
        DriverManager.setLoginTimeout(loginSec);
        Connection c = DriverManager.getConnection(url, props);
        if ("mysql".equals(type)) {
            // MySQL 5.7 + Connector/J: force session charset so UTF-8 payload is not latin1-mojibake.
            try (Statement st = c.createStatement()) {
                st.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
            }
        }
        if ("postgresql".equals(type) && spec.schema() != null && !spec.schema().isBlank()) {
            requireIdent(spec.schema(), "schema");
            try (Statement st = c.createStatement()) {
                st.execute("SET search_path TO " + quote(spec, spec.schema()));
            }
        }
        return c;
    }

    @Override
    public int cancelLiveQueries(String owner) {
        return liveQueries.cancelByOwner(owner == null ? "" : owner);
    }

    @Override
    public Map<String, Object> liveQueryStats() {
        return liveQueries.snapshot();
    }

    private String qualify(ConnectionSpec spec, String table) {
        String type = spec.normalizedType();
        String schema = effectiveSchema(spec);
        if ("postgresql".equals(type) && schema != null && !schema.isBlank()) {
            requireIdent(schema, "schema");
            return quote(spec, schema) + "." + quote(spec, table);
        }
        if ("mysql".equals(type) && spec.dbName() != null && !spec.dbName().isBlank()) {
            requireIdent(spec.dbName(), "database");
            return quote(spec, spec.dbName()) + "." + quote(spec, table);
        }
        return quote(spec, table);
    }

    private static String sqlLiteral(Object raw) {
        if (raw == null) return "NULL";
        if (raw instanceof Number n) return n.toString();
        String s = String.valueOf(raw);
        if (s.length() > 128) s = s.substring(0, 128);
        return "'" + s.replace("'", "''").replace("\0", "") + "'";
    }

    private String quote(ConnectionSpec spec, String ident) {
        requireIdent(ident, "标识符");
        return "mysql".equals(spec.normalizedType()) ? "`" + ident + "`" : "\"" + ident + "\"";
    }

    private String effectiveSchema(ConnectionSpec spec) {
        if (spec.schema() != null && !spec.schema().isBlank()) return spec.schema();
        if ("postgresql".equals(spec.normalizedType())) return "public";
        return null;
    }

    private static String bootstrapDb(ConnectionSpec spec) {
        if (spec.dbName() != null && !spec.dbName().isBlank()) return spec.dbName();
        return "postgresql".equals(spec.normalizedType()) ? "postgres" : "mysql";
    }

    private static void requireDb(ConnectionSpec spec) {
        if (spec.dbName() == null || spec.dbName().isBlank()) {
            throw new IllegalArgumentException("请先选择 database");
        }
    }

    private static void requireIdent(String v, String label) {
        if (v == null || !IDENT.matcher(v).matches()) {
            throw new IllegalArgumentException(label + "非法: " + v);
        }
    }

    private static int clampLimit(Integer limit, int fallback) {
        int n = limit == null || limit <= 0 ? fallback : limit;
        return Math.min(n, HARD_MAX_ROWS);
    }

    private static int defaultPort(String type) {
        return "mysql".equals(type) ? 3306 : 5432;
    }

    private static boolean isMysqlSystemDb(String name) {
        return name == null || List.of("information_schema", "mysql", "performance_schema", "sys").contains(name);
    }

    private static String normalizeAgg(String agg) {
        if (agg == null || agg.isBlank()) return "SUM";
        return switch (agg.toUpperCase(Locale.ROOT)) {
            case "SUM", "COUNT", "AVG", "MAX", "MIN", "RAW" -> agg.toUpperCase(Locale.ROOT);
            case "CNT_DISTINCT", "COUNT_DISTINCT" -> "COUNT";
            default -> "SUM";
        };
    }

    private static String mapDataType(String typeName) {
        if (typeName == null) return "STRING";
        String t = typeName.toLowerCase(Locale.ROOT);
        if (t.contains("int") || t.contains("decimal") || t.contains("numeric") || t.contains("double")
                || t.contains("float") || t.contains("real") || t.contains("serial") || t.contains("money")) {
            return "DECIMAL";
        }
        if (t.contains("bool")) return "BOOLEAN";
        if (t.contains("date") || t.contains("time")) return "TIME";
        return "STRING";
    }

    private static Object readCell(ResultSet rs, int i, int sqlType) throws Exception {
        Object v = rs.getObject(i);
        if (v == null) return null;
        if (sqlType == Types.BIGINT) return rs.getLong(i);
        if (sqlType == Types.INTEGER || sqlType == Types.SMALLINT || sqlType == Types.TINYINT) return rs.getInt(i);
        if (sqlType == Types.DOUBLE || sqlType == Types.FLOAT || sqlType == Types.REAL || sqlType == Types.DECIMAL
                || sqlType == Types.NUMERIC) {
            return rs.getDouble(i);
        }
        if (v instanceof java.sql.Timestamp ts) return ts.toInstant().toString();
        if (v instanceof java.sql.Date d) return d.toString();
        if (v instanceof java.sql.Time t) return t.toString();
        return String.valueOf(v);
    }

    private static String blankTo(String v, String fallback) {
        return v == null || v.isBlank() ? fallback : v.trim();
    }

    private static String rootMessage(Throwable e) {
        Throwable cur = e;
        while (cur.getCause() != null && cur.getCause() != cur) cur = cur.getCause();
        String m = cur.getMessage();
        return m == null || m.isBlank() ? cur.getClass().getSimpleName() : m;
    }

    private static IllegalArgumentException unsupported(String type) {
        return new IllegalArgumentException("暂不支持的数据源类型: " + type + "（一期仅 MySQL / PostgreSQL）");
    }
}
