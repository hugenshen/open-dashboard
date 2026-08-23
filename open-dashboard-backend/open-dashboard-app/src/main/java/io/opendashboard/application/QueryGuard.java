package io.opendashboard.application;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.QueryDtos.ColumnMeta;
import io.opendashboard.domain.QueryDtos.DatasetQueryRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.exception.ForbiddenException;
import io.opendashboard.domain.gateway.ResourceAccessPort;
import io.opendashboard.domain.gateway.ResourceAccessPort.DataPolicy;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Sole data-plane gate: dataset ACL + Java-injected RLS/CLS. LLM must not rewrite this SQL.
 */
@Service
public class QueryGuard {

    private static final Pattern IDENT = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*$");
    private static final ThreadLocal<Boolean> BYPASS = new ThreadLocal<>();

    private final EffectiveAccessService access;
    private final ObjectProvider<ResourceAccessPort> store;
    private final IdentityRepositoryHolder identity;
    private final ObjectMapper mapper = new ObjectMapper();

    public QueryGuard(
            EffectiveAccessService access,
            ObjectProvider<ResourceAccessPort> store,
            io.opendashboard.domain.gateway.IdentityRepository identity
    ) {
        this.access = access;
        this.store = store;
        this.identity = new IdentityRepositoryHolder(identity);
    }

    public static boolean bypassed() {
        return Boolean.TRUE.equals(BYPASS.get());
    }

    public static <T> T bypass(Supplier<T> action) {
        BYPASS.set(true);
        try {
            return action.get();
        } finally {
            BYPASS.remove();
        }
    }

    public void requireDatasetUse(String datasetId) {
        if (bypassed()) return;
        access.requireDatasetUse(AuthContext.get(), datasetId);
    }

    public void requireDashboardView(String dashboardId) {
        if (bypassed() || dashboardId == null || dashboardId.isBlank()) return;
        access.requireDashboardView(AuthContext.get(), dashboardId);
    }

    public void requireDashboardWrite(String dashboardId) {
        if (bypassed() || dashboardId == null || dashboardId.isBlank()) return;
        access.requireDashboardWrite(AuthContext.get(), dashboardId);
    }

    public DatasetQueryRequest applyToRequest(DatasetQueryRequest request) {
        if (request == null) return null;
        String datasetId = request.datasetId();
        requireDatasetUse(datasetId);
        BoundPolicy policy = resolve(AuthContext.get(), datasetId);
        rejectHiddenFields(request.dimensions(), policy.hidden);
        rejectHiddenFields(request.measures(), policy.hidden);
        if (request.columns() != null) {
            for (String col : request.columns()) {
                rejectHiddenName(col, policy.hidden);
            }
        }
        Map<String, Object> filters = mergeFilters(request.filters(), policy.rowItems);
        List<String> columns = dropHiddenNames(request.columns(), policy.hidden);
        return new DatasetQueryRequest(
                request.datasetId(),
                request.dimensions(),
                request.measures(),
                columns,
                filters,
                request.limit(),
                request.options()
        );
    }

    public String wrapSql(String datasetId, String sql) {
        requireDatasetUse(datasetId);
        BoundPolicy policy = resolve(AuthContext.get(), datasetId);
        rejectHiddenInSql(sql, policy.hidden);
        if (policy.rowItems.isEmpty()) return sql;
        String where = compileWhere(policy.rowItems);
        if (where.isBlank()) return sql;
        return "SELECT * FROM (" + sql + ") _od_acl WHERE " + where;
    }

    public List<String> filterSchemaFieldNames(String datasetId, List<String> names) {
        BoundPolicy policy = resolve(AuthContext.get(), datasetId);
        if (policy.hidden.isEmpty() || names == null) return names;
        List<String> out = new ArrayList<>();
        for (String name : names) {
            if (name != null && policy.hidden.contains(name.toLowerCase(Locale.ROOT))) continue;
            out.add(name);
        }
        return out;
    }

    public DatasetQueryResult stripHidden(String datasetId, DatasetQueryResult result) {
        if (result == null) return null;
        BoundPolicy policy = resolve(AuthContext.get(), datasetId);
        if (policy.hidden.isEmpty() || result.columns() == null || result.columns().isEmpty()) {
            return result;
        }
        List<Integer> keep = new ArrayList<>();
        List<ColumnMeta> cols = new ArrayList<>();
        for (int i = 0; i < result.columns().size(); i++) {
            ColumnMeta c = result.columns().get(i);
            String name = c == null ? "" : (c.name() == null ? "" : c.name());
            if (policy.hidden.contains(name.toLowerCase(Locale.ROOT))) continue;
            keep.add(i);
            cols.add(c);
        }
        List<List<Object>> rows = new ArrayList<>();
        if (result.rows() != null) {
            for (List<Object> row : result.rows()) {
                List<Object> next = new ArrayList<>();
                for (int idx : keep) {
                    next.add(row != null && idx < row.size() ? row.get(idx) : null);
                }
                rows.add(next);
            }
        }
        return new DatasetQueryResult(cols, rows, result.truncated(), result.sql(), result.elapsedMs());
    }

    private BoundPolicy resolve(AuthPrincipal principal, String datasetId) {
        BoundPolicy empty = new BoundPolicy(List.of(), Set.of());
        if (bypassed() || principal == null || datasetId == null || datasetId.isBlank()) return empty;
        ResourceAccessPort port = store.getIfAvailable();
        if (port == null) return empty;
        Set<String> keys = identity.subjectKeys(principal);
        List<Map<String, Object>> items = new ArrayList<>();
        Set<String> hidden = new LinkedHashSet<>();
        for (DataPolicy p : port.listPolicies(principal.workspaceId(), datasetId)) {
            if (!p.enabled()) continue;
            if (!keys.contains(p.subjectType() + ":" + p.subjectId())) continue;
            Map<String, Object> pred = parseJson(p.predicateJson());
            if ("row".equals(p.kind())) {
                Object raw = pred.get("items");
                if (raw instanceof List<?> list) {
                    for (Object it : list) {
                        if (it instanceof Map<?, ?> m) {
                            Map<String, Object> row = new LinkedHashMap<>();
                            m.forEach((k, v) -> row.put(String.valueOf(k), v));
                            items.add(row);
                        }
                    }
                }
            } else if ("column".equals(p.kind())) {
                Object hide = pred.get("hide");
                if (hide == null) hide = pred.get("columns");
                if (hide instanceof List<?> list) {
                    for (Object col : list) {
                        if (col != null && !String.valueOf(col).isBlank()) {
                            hidden.add(String.valueOf(col).toLowerCase(Locale.ROOT));
                        }
                    }
                }
            }
        }
        return new BoundPolicy(items, hidden);
    }

    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return mapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private static Map<String, Object> mergeFilters(Map<String, Object> a, List<Map<String, Object>> extra) {
        if (extra == null || extra.isEmpty()) return a;
        Map<String, Object> policy = new LinkedHashMap<>();
        policy.put("items", extra);
        return StubQueryServiceMerge.merge(a, policy);
    }

    private static void rejectHiddenFields(List<Map<String, Object>> fields, Set<String> hidden) {
        if (fields == null || hidden.isEmpty()) return;
        for (Map<String, Object> f : fields) {
            if (f == null || f.get("field") == null) continue;
            rejectHiddenName(String.valueOf(f.get("field")), hidden);
        }
    }

    private static void rejectHiddenName(String name, Set<String> hidden) {
        if (name == null || hidden.isEmpty()) return;
        if (hidden.contains(name.toLowerCase(Locale.ROOT))) {
            throw new ForbiddenException("DATASET_COLUMN_FORBIDDEN: " + name);
        }
    }

    private static List<String> dropHiddenNames(List<String> columns, Set<String> hidden) {
        if (columns == null || hidden.isEmpty()) return columns;
        List<String> out = new ArrayList<>();
        for (String col : columns) {
            if (col != null && hidden.contains(col.toLowerCase(Locale.ROOT))) continue;
            out.add(col);
        }
        return out;
    }

    private static void rejectHiddenInSql(String sql, Set<String> hidden) {
        if (sql == null || hidden.isEmpty()) return;
        String lower = sql.toLowerCase(Locale.ROOT);
        for (String col : hidden) {
            if (!IDENT.matcher(col).matches()) continue;
            Pattern p = Pattern.compile("(?i)(?<![A-Za-z0-9_])" + Pattern.quote(col) + "(?![A-Za-z0-9_])");
            if (p.matcher(lower).find()) {
                throw new ForbiddenException("DATASET_COLUMN_FORBIDDEN: " + col);
            }
        }
    }

    static String compileWhere(List<Map<String, Object>> items) {
        List<String> parts = new ArrayList<>();
        for (Map<String, Object> m : items) {
            String field = m.get("field") == null ? "" : String.valueOf(m.get("field"));
            if (!IDENT.matcher(field).matches()) {
                throw new ForbiddenException("POLICY_BIND_FAILED: invalid field");
            }
            Object opObj = m.get("op") != null ? m.get("op") : m.get("operator");
            String op = opObj == null ? "eq" : String.valueOf(opObj).toLowerCase(Locale.ROOT);
            String qf = "\"" + field + "\"";
            Object value = m.get("value");
            if ("in".equals(op) && value instanceof List<?> vals) {
                List<String> lits = new ArrayList<>();
                for (Object v : vals) {
                    if (v != null && !String.valueOf(v).isBlank()) lits.add(sqlLiteral(v));
                }
                if (!lits.isEmpty()) parts.add(qf + " IN (" + String.join(", ", lits) + ")");
            } else if (value != null && !String.valueOf(value).isBlank()) {
                parts.add(qf + " = " + sqlLiteral(value));
            }
        }
        return String.join(" AND ", parts);
    }

    private static String sqlLiteral(Object value) {
        String s = String.valueOf(value).replace("'", "''");
        return "'" + s + "'";
    }

    private record BoundPolicy(List<Map<String, Object>> rowItems, Set<String> hidden) {}

    private static final class IdentityRepositoryHolder {
        private final io.opendashboard.domain.gateway.IdentityRepository identity;

        private IdentityRepositoryHolder(io.opendashboard.domain.gateway.IdentityRepository identity) {
            this.identity = identity;
        }

        Set<String> subjectKeys(AuthPrincipal principal) {
            Set<String> keys = new LinkedHashSet<>();
            keys.add("user:" + principal.userId());
            for (String role : identity.rolesForUser(principal.userId(), principal.workspaceId())) {
                keys.add("role:" + role);
            }
            return keys;
        }
    }

    /** Avoid a compile cycle with StubQueryService.mergeFilterAst (package-private reuse). */
    static final class StubQueryServiceMerge {
        private StubQueryServiceMerge() {}

        @SuppressWarnings("unchecked")
        static Map<String, Object> merge(Map<String, Object> a, Map<String, Object> b) {
            if (a == null || a.isEmpty()) return b;
            if (b == null || b.isEmpty()) return a;
            List<Object> items = new ArrayList<>();
            Object la = a.get("items");
            Object lb = b.get("items");
            if (la instanceof List<?> l1) items.addAll(l1);
            if (lb instanceof List<?> l2) items.addAll(l2);
            Map<String, Object> out = new LinkedHashMap<>(a);
            out.put("items", items);
            return out;
        }
    }
}
