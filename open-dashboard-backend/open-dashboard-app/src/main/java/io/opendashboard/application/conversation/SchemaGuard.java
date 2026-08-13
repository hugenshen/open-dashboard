package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Validates dataset schemas and patch ops before apply. */
public final class SchemaGuard {

    private SchemaGuard() {}

    public record SchemaBundle(
            Map<String, DatasetDetailVO> byId,
            List<String> missingIds
    ) {
        public boolean okForPagePatch() {
            return missingIds.isEmpty() && !byId.isEmpty();
        }
    }

    public static SchemaBundle load(List<String> datasetIds, Map<String, DatasetDetailVO> loaded) {
        Map<String, DatasetDetailVO> byId = new HashMap<>();
        List<String> missing = new ArrayList<>();
        if (datasetIds == null || datasetIds.isEmpty()) {
            return new SchemaBundle(byId, List.of("(none)"));
        }
        for (String id : datasetIds) {
            if (id == null || id.isBlank()) continue;
            DatasetDetailVO detail = loaded.get(id);
            if (detail == null || detail.fields() == null || detail.fields().isEmpty()) {
                missing.add(id);
            } else {
                byId.put(id, detail);
            }
        }
        return new SchemaBundle(byId, missing);
    }

    public static List<String> validateOps(List<Map<String, Object>> ops, SchemaBundle schema) {
        List<String> errors = new ArrayList<>();
        if (ops == null) return List.of("empty ops");
        for (Map<String, Object> op : ops) {
            String kind = str(op.get("op"));
            if ("upsert_chart".equals(kind)) {
                String datasetId = str(op.get("datasetId"));
                if (datasetId.isBlank()) {
                    errors.add("upsert_chart missing datasetId");
                    continue;
                }
                DatasetDetailVO detail = schema.byId().get(datasetId);
                if (detail == null) {
                    errors.add("unknown datasetId: " + datasetId);
                    continue;
                }
                Set<String> fields = fieldNames(detail);
                Object encodeObj = op.get("encode");
                if (encodeObj instanceof Map<?, ?> encode) {
                    checkField(encode.get("category"), fields, errors, datasetId);
                    checkField(encode.get("value"), fields, errors, datasetId);
                    checkField(encode.get("x"), fields, errors, datasetId);
                    checkField(encode.get("y"), fields, errors, datasetId);
                }
            }
        }
        return errors;
    }

    private static void checkField(Object raw, Set<String> fields, List<String> errors, String datasetId) {
        if (raw == null) return;
        String name = String.valueOf(raw).trim();
        if (name.isEmpty()) return;
        if (!fields.contains(name)) {
            errors.add("field not in schema " + datasetId + ": " + name);
        }
    }

    private static Set<String> fieldNames(DatasetDetailVO detail) {
        Set<String> set = new HashSet<>();
        for (DatasetFieldVO f : detail.fields()) {
            if (f.name() != null) set.add(f.name());
        }
        return set;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }
}
