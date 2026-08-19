package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 词表对齐（阶段2，PR-KB-02）：把 de_glossary 的业务词（「销售额」「GMV」）注入
 * schema 的字段 label（frozen 快照，不改字段名），使 IntentResolver 的关键词匹配
 * 能命中 canonical 字段（销售额 → spending_amount）。
 *
 * 对齐方式：term → canonical_field 的映射，把 term 追加到该字段 label 的括号后缀，
 * 匹配逻辑（findField / containsAny）不变，只扩词。
 */
public final class GlossaryAwareSchema {

    private GlossaryAwareSchema() {}

    public static SchemaGuard.SchemaBundle enrich(
            SchemaGuard.SchemaBundle schema,
            KnowledgeService knowledge,
            List<String> datasetIds
    ) {
        if (schema == null || schema.byId().isEmpty()) return schema;
        Map<String, Object> k = knowledge.knowledgeFor(datasetIds == null ? List.of() : datasetIds);
        List<?> terms = k.get("terms") instanceof List<?> list ? list : List.of();
        // field -> [term...]（按 dataset 分组）
        Map<String, Map<String, List<String>>> byDataset = new HashMap<>();
        for (Object o : terms) {
            if (!(o instanceof Map<?, ?> m)) continue;
            String ds = String.valueOf(m.get("datasetId"));
            String field = String.valueOf(m.get("field"));
            String term = String.valueOf(m.get("term"));
            if (ds.isBlank() || field.isBlank() || term.isBlank() || "null".equals(term)) continue;
            byDataset.computeIfAbsent(ds, x -> new HashMap<>())
                    .computeIfAbsent(field, x -> new ArrayList<>())
                    .add(term);
        }
        if (byDataset.isEmpty()) return schema;

        Map<String, DatasetDetailVO> enriched = new LinkedHashMap<>();
        for (Map.Entry<String, DatasetDetailVO> e : schema.byId().entrySet()) {
            DatasetDetailVO d = e.getValue();
            Map<String, List<String>> termsByField = byDataset.get(e.getKey());
            if (termsByField == null || termsByField.isEmpty()) {
                enriched.put(e.getKey(), d);
                continue;
            }
            List<DatasetFieldVO> fields = new ArrayList<>();
            if (d.fields() != null) {
                for (DatasetFieldVO f : d.fields()) {
                    List<String> ts = termsByField.get(f.name());
                    if (ts == null || ts.isEmpty()) {
                        fields.add(f);
                        continue;
                    }
                    String label = f.label() == null || f.label().isBlank() ? f.name() : f.label();
                    // 已含该词则跳过，避免重复括号
                    StringBuilder suffix = new StringBuilder();
                    for (String t : ts) {
                        if (!label.contains(t)) {
                            if (!suffix.isEmpty()) suffix.append("/");
                            suffix.append(t);
                        }
                    }
                    if (suffix.isEmpty()) {
                        fields.add(f);
                    } else {
                        fields.add(new DatasetFieldVO(f.name(), label + "(" + suffix + ")", f.group(), f.dataType(), f.origin(), f.expression()));
                    }
                }
            }
            enriched.put(e.getKey(), new DatasetDetailVO(d.meta(), fields));
        }
        return new SchemaGuard.SchemaBundle(enriched, schema.missingIds());
    }
}
