package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.FieldProfileVO;
import io.opendashboard.domain.DatasetDtos.GlossaryItemVO;
import io.opendashboard.domain.DatasetDtos.GlossaryUpsertRequest;
import io.opendashboard.domain.DatasetDtos.IndicatorUpsertRequest;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.gateway.FieldProfileGateway;
import io.opendashboard.domain.gateway.GlossaryGateway;
import io.opendashboard.domain.gateway.IndicatorGateway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 自学习第二段：Harness LLM 复核规则角色，只改 role / 业务名 / 别名。
 * 已确认指标与词表不覆盖。Harness 不可用或 LLM 失败时保留规则结果。
 */
@Component
public class FieldLearnReviewer {

    private static final Logger log = LoggerFactory.getLogger(FieldLearnReviewer.class);

    private final AgentHarnessClient harness;
    private final ObjectProvider<FieldProfileGateway> profileStore;
    private final ObjectProvider<IndicatorGateway> indicatorStore;
    private final ObjectProvider<GlossaryGateway> glossaryStore;

    public FieldLearnReviewer(
            AgentHarnessClient harness,
            ObjectProvider<FieldProfileGateway> profileStore,
            ObjectProvider<IndicatorGateway> indicatorStore,
            ObjectProvider<GlossaryGateway> glossaryStore
    ) {
        this.harness = harness;
        this.profileStore = profileStore;
        this.indicatorStore = indicatorStore;
        this.glossaryStore = glossaryStore;
    }

    public Map<String, Object> apply(String datasetId) {
        return apply(datasetId, AuthContext.get());
    }

    public Map<String, Object> apply(String datasetId, AuthPrincipal principal) {
        return apply(datasetId, principal, () -> false);
    }

    public Map<String, Object> apply(String datasetId, AuthPrincipal principal, java.util.function.BooleanSupplier cancelled) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("llmReviewed", false);
        out.put("llmSource", "skipped");
        out.put("llmChanged", 0);
        if (cancelled != null && cancelled.getAsBoolean()) {
            out.put("llmSkipReason", "cancelled");
            return out;
        }
        if (datasetId == null || datasetId.isBlank()) {
            out.put("llmSkipReason", "datasetId required");
            return out;
        }
        FieldProfileGateway store = profileStore.getIfAvailable();
        if (store == null) {
            out.put("llmSkipReason", "no profile store");
            return out;
        }
        List<FieldProfileVO> existing;
        try {
            existing = store.listByDataset(datasetId);
        } catch (Exception e) {
            out.put("llmSkipReason", "load profile failed");
            return out;
        }
        if (existing == null || existing.isEmpty()) {
            out.put("llmSkipReason", "no stats profile");
            return out;
        }

        Map<String, Object> review;
        try {
            review = harness.reviewFields(datasetId, principal, cancelled);
        } catch (java.util.concurrent.CancellationException e) {
            out.put("llmSkipReason", "cancelled");
            return out;
        } catch (Exception e) {
            log.info("[field-review] harness skip dataset={}: {}", datasetId, e.getMessage());
            out.put("llmSkipReason", "harness unavailable");
            return out;
        }
        if (cancelled != null && cancelled.getAsBoolean()) {
            out.put("llmSkipReason", "cancelled");
            return out;
        }
        if (review == null || !Boolean.TRUE.equals(review.get("ok"))) {
            out.put("llmSkipReason", "review failed");
            return out;
        }
        String source = review.get("source") == null ? "" : String.valueOf(review.get("source"));
        out.put("llmSource", source);
        if (!"llm".equals(source)) {
            out.put("llmSkipReason", "llm fallback to stats");
            return out;
        }
        Object rawFields = review.get("fields");
        if (!(rawFields instanceof List<?> llmFields) || llmFields.isEmpty()) {
            out.put("llmSkipReason", "empty llm fields");
            return out;
        }

        Map<String, FieldProfileVO> byName = new LinkedHashMap<>();
        for (FieldProfileVO p : existing) {
            byName.put(p.fieldName(), p);
        }
        int changed = 0;
        for (Object o : llmFields) {
            if (!(o instanceof Map<?, ?> row)) continue;
            String name = str(row.get("name"));
            if (name.isBlank()) continue;
            FieldProfileVO cur = byName.get(name);
            if (cur == null) continue;
            String role = normalizeRole(str(row.get("role")));
            if (role == null) continue;
            String alias = str(row.get("alias"));
            String meaning = str(row.get("label"));
            String business = shortName(alias.isBlank() ? meaning : alias);
            boolean roleChanged = !role.equals(cur.roleLearned());
            boolean labelChanged = !business.isBlank()
                    && (cur.fieldLabel() == null || cur.fieldLabel().isBlank()
                    || cur.fieldLabel().equals(cur.fieldName()));
            if (!roleChanged && !labelChanged && alias.isBlank()) continue;

            String nextLabel = labelChanged ? business : cur.fieldLabel();
            FieldProfileVO next = new FieldProfileVO(
                    cur.datasetId(), cur.fieldName(), nextLabel, cur.dataType(),
                    role, "llm",
                    cur.distinctCount(), cur.nullCount(), cur.nullRate(),
                    cur.numericMin(), cur.numericMax(), cur.distinctValues(),
                    cur.timestampLike(), cur.sample(), System.currentTimeMillis()
            );
            store.save(next);
            byName.put(name, next);
            changed++;
            if ("measure".equals(role)) {
                upsertDraftIndicator(datasetId, name, nextLabel.isBlank() ? name : nextLabel);
            }
            if (!alias.isBlank()) {
                upsertAlias(datasetId, name, alias, role);
            } else if (!business.isBlank() && !"measure".equals(role) && !"id".equals(role)) {
                upsertAlias(datasetId, name, business, role);
            }
        }
        out.put("llmReviewed", true);
        out.put("llmChanged", changed);
        log.info("[field-review] dataset={} changed={}", datasetId, changed);
        return out;
    }

    private void upsertDraftIndicator(String datasetId, String fieldName, String businessName) {
        IndicatorGateway g = indicatorStore.getIfAvailable();
        if (g == null) return;
        try {
            if (g.findByField(datasetId, fieldName).map(it -> "confirmed".equals(it.status())).orElse(false)) {
                return;
            }
            boolean hasDraft = g.findByField(datasetId, fieldName).isPresent();
            if (hasDraft) return;
            g.upsert(new IndicatorUpsertRequest(
                    datasetId, fieldName, businessName, "SUM", null, null, null, "draft", 0.6
            ));
        } catch (Exception e) {
            log.debug("[field-review] indicator skip {}: {}", fieldName, e.getMessage());
        }
    }

    private void upsertAlias(String datasetId, String fieldName, String term, String role) {
        GlossaryGateway g = glossaryStore.getIfAvailable();
        if (g == null || term == null || term.isBlank() || term.equals(fieldName)) return;
        try {
            for (GlossaryItemVO it : g.listByDataset(datasetId)) {
                if (term.equals(it.term()) && "confirmed".equals(it.status())) {
                    return;
                }
            }
            String type = "measure".equals(role) ? "metric"
                    : "dim".equals(role) ? "dimension"
                    : "flag".equals(role) ? "flag" : "entity";
            g.upsert(new GlossaryUpsertRequest(
                    term, type, datasetId, fieldName, List.of(term), null,
                    "candidate", 0.6, "llm"
            ));
        } catch (Exception e) {
            log.debug("[field-review] glossary skip {}: {}", fieldName, e.getMessage());
        }
    }

    static String normalizeRole(String raw) {
        if (raw == null || raw.isBlank()) return null;
        return switch (raw.trim().toLowerCase(Locale.ROOT)) {
            case "dimension", "dim" -> "dim";
            case "measure", "metric" -> "measure";
            case "time", "date", "datetime", "timestamp" -> "time";
            case "id", "identifier", "pk", "fk" -> "id";
            case "flag", "boolean", "bool" -> "flag";
            case "text", "longtext" -> "text";
            case "junk", "ignore", "unused" -> "junk";
            default -> null;
        };
    }

    private static String shortName(String s) {
        if (s == null) return "";
        String t = s.trim();
        int colon = t.indexOf('：');
        if (colon <= 0) colon = t.indexOf(':');
        if (colon > 0 && colon < 24) t = t.substring(0, colon);
        if (t.length() > 24) t = t.substring(0, 24);
        return t.trim();
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }
}
