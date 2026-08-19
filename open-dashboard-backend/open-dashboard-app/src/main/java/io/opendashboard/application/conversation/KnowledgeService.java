package io.opendashboard.application.conversation;

import io.opendashboard.domain.DatasetDtos.FieldInterpretVO;
import io.opendashboard.domain.DatasetDtos.GlossaryItemVO;
import io.opendashboard.domain.DatasetDtos.GlossaryUpsertRequest;
import io.opendashboard.domain.DatasetDtos.IndicatorUpsertRequest;
import io.opendashboard.domain.DatasetDtos.IndicatorVO;
import io.opendashboard.domain.gateway.GlossaryGateway;
import io.opendashboard.domain.gateway.IndicatorGateway;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 知识体系服务（阶段2：IndicatorRegistry + BusinessGlossary）。
 *
 * - 指标注册表：Learner 写 draft 候选 → 管理页确认 → confirmed 权威口径（agg/unit/公式）；
 *   confirmed 指标被 harness <knowledge> 注入与 od_plan_charts 选指标消费。
 * - 业务词表：用户自然语言「销售额」→ canonical_field（spending_amount）对齐。
 * - od_interpret_fields 回写 confidence（自学习闭环：生成验证了字段语义）。
 */
@Service
public class KnowledgeService {

    private final ObjectProvider<IndicatorGateway> indicatorStore;
    private final ObjectProvider<GlossaryGateway> glossaryStore;

    public KnowledgeService(
            ObjectProvider<IndicatorGateway> indicatorStore,
            ObjectProvider<GlossaryGateway> glossaryStore
    ) {
        this.indicatorStore = indicatorStore;
        this.glossaryStore = glossaryStore;
    }

    // ── 指标注册表 CRUD ────────────────────────────────────────────────

    public List<IndicatorVO> listIndicators(String datasetId) {
        IndicatorGateway g = indicatorStore.getIfAvailable();
        return g == null ? List.of() : g.listByDataset(datasetId);
    }

    public Optional<IndicatorVO> createIndicator(IndicatorUpsertRequest req) {
        IndicatorGateway g = indicatorStore.getIfAvailable();
        if (g == null || req == null || req.datasetId() == null || req.datasetId().isBlank()) return Optional.empty();
        String name = req.name() == null || req.name().isBlank() ? req.fieldName() : req.name();
        return Optional.ofNullable(g.upsert(new IndicatorUpsertRequest(
                req.datasetId(), req.fieldName(), name, req.agg(), req.unit(), req.formula(),
                req.description(),
                req.status() == null || req.status().isBlank() ? "draft" : req.status(),
                req.confidence() == null ? 0.5 : req.confidence()
        )));
    }

    /** draft → confirmed（人工确认，DeerMem confirmationCount 语义：确认即权威）。 */
    public Optional<IndicatorVO> confirm(Long id) {
        IndicatorGateway g = indicatorStore.getIfAvailable();
        return g == null ? Optional.empty() : g.updateStatus(id, "confirmed");
    }

    /** confirmed → deprecated（口径作废）。 */
    public Optional<IndicatorVO> deprecate(Long id) {
        IndicatorGateway g = indicatorStore.getIfAvailable();
        return g == null ? Optional.empty() : g.updateStatus(id, "deprecated");
    }

    public boolean deleteIndicator(Long id) {
        IndicatorGateway g = indicatorStore.getIfAvailable();
        return g != null && g.delete(id);
    }

    // ── 业务词表 ───────────────────────────────────────────────────────

    public List<GlossaryItemVO> listGlossary(String datasetId) {
        GlossaryGateway g = glossaryStore.getIfAvailable();
        return g == null ? List.of() : g.listByDataset(datasetId);
    }

    // ── 知识注入（harness <knowledge> 块，frozen-snapshot） ─────────────

    /**
     * 返回 harness 注入所需的知识载荷：confirmed 指标（metrics）+ 词表（terms）。
     * metrics: [{field,name,agg,unit,formula,confidence}]
     * terms:   [{term,type,field,aliases,dataset}]
     */
    public Map<String, Object> knowledgeFor(List<String> datasetIds) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> metrics = new ArrayList<>();
        List<Map<String, Object>> terms = new ArrayList<>();
        IndicatorGateway ig = indicatorStore.getIfAvailable();
        if (ig != null && datasetIds != null) {
            for (IndicatorVO v : ig.listConfirmedForDatasets(datasetIds)) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("datasetId", v.datasetId());
                m.put("field", v.fieldName());
                m.put("name", v.name());
                m.put("agg", v.agg());
                m.put("unit", v.unit());
                m.put("formula", v.formula());
                m.put("confidence", v.confidence());
                metrics.add(m);
            }
        }
        GlossaryGateway gg = glossaryStore.getIfAvailable();
        if (gg != null && datasetIds != null) {
            for (String ds : datasetIds) {
                for (GlossaryItemVO item : gg.listByDataset(ds)) {
                    if (item.canonicalField() == null || item.canonicalField().isBlank()) continue;
                    Map<String, Object> t = new LinkedHashMap<>();
                    t.put("term", item.term());
                    t.put("type", item.type());
                    t.put("datasetId", item.datasetId());
                    t.put("field", item.canonicalField());
                    List<String> aliases = new ArrayList<>();
                    if (item.aliases() != null) aliases.addAll(item.aliases());
                    if (!aliases.contains(item.term())) aliases.add(item.term());
                    t.put("aliases", aliases);
                    t.put("status", item.status());
                    terms.add(t);
                }
            }
        }
        out.put("metrics", metrics);
        out.put("terms", terms);
        return out;
    }

    // ── od_interpret_fields 回写（自学习闭环） ─────────────────────────

    /**
     * LLM 语义解释回写：
     * 1) measure 字段命中 draft 指标 → confidence 提升（生成验证了字段语义）；
     * 2) 解释给出的别名 → 写入 de_glossary（metric 词表，term=别名，canonical=字段）。
     */
    public Map<String, Object> interpretFields(String datasetId, List<FieldInterpretVO> fields) {
        IndicatorGateway ig = indicatorStore.getIfAvailable();
        GlossaryGateway gg = glossaryStore.getIfAvailable();
        int confirmed = 0, glossaryUpserts = 0;
        if (fields != null) {
            for (FieldInterpretVO f : fields) {
                if (f == null || f.field() == null || f.field().isBlank()) continue;
                // 1) 指标 confidence 提升：role=measure 且已有该字段的指标条目（draft 与 confirmed 都回写）
                if ("measure".equals(f.role()) && ig != null) {
                    Optional<IndicatorVO> existing = ig.findByField(datasetId, f.field());
                    if (existing.isPresent()) {
                        double base = existing.get().confidence() == null ? 0.5 : existing.get().confidence();
                        double bumped = Math.min(1.0, base + (f.confidence() == null ? 0.1 : f.confidence() * 0.3));
                        ig.updateConfidence(existing.get().id(), bumped);
                        confirmed++;
                    }
                }
                // 2) 别名 → 词表（term=别名，canonical=字段）
                if (gg != null && f.aliases() != null && !f.aliases().isEmpty()) {
                    String canonical = f.field();
                    String roleType = "measure".equals(f.role()) ? "metric"
                            : "dim".equals(f.role()) ? "dimension"
                            : "flag".equals(f.role()) ? "flag" : "entity";
                    for (String alias : f.aliases()) {
                        if (alias == null || alias.isBlank() || alias.equals(canonical)) continue;
                        gg.upsert(new GlossaryUpsertRequest(
                                alias, roleType, datasetId, canonical, List.of(alias), null,
                                "candidate", 0.6, "learned"
                        ));
                        glossaryUpserts++;
                    }
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("datasetId", datasetId);
        out.put("confidenceBumped", confirmed);
        out.put("glossaryUpserts", glossaryUpserts);
        return out;
    }
}
