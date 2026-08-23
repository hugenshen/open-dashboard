package io.opendashboard.application.conversation;

import io.opendashboard.application.DatasetService;
import io.opendashboard.application.StubQueryService;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.DatasetDtos.FieldProfileVO;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.gateway.FieldProfileGateway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 数据集自学习（阶段1）：录入后采样真实数据，按统计特征判定字段角色（确定性写闸，
 * 命名仅作候选打分），并把采样/统计写入 de_dataset_field_profile 供 LLM 语义解释
 * （od_interpret_fields）与 schema 返回体复用。
 *
 * 沿用 ref/deer-flow 记忆的「先过滤 → 判定 → 确定性写闸 → 落库」四段式：
 * 统计特征为准；不再用业务词词典给角色/单位打分。
 */
@Component
public class DatasetProfileLearner {

    private static final Logger log = LoggerFactory.getLogger(DatasetProfileLearner.class);
    private static final int SAMPLE_ROWS = 30;
    private static final int MAX_DISTINCT_VALUES = 20;

    private final DatasetService datasets;
    private final StubQueryService queryService;
    private final ObjectProvider<FieldProfileGateway> profileStore;
    private final ObjectProvider<io.opendashboard.domain.gateway.GlossaryGateway> glossaryStore;
    private final ObjectProvider<io.opendashboard.domain.gateway.IndicatorGateway> indicatorStore;

    public DatasetProfileLearner(
            DatasetService datasets,
            StubQueryService queryService,
            ObjectProvider<FieldProfileGateway> profileStore,
            ObjectProvider<io.opendashboard.domain.gateway.GlossaryGateway> glossaryStore,
            ObjectProvider<io.opendashboard.domain.gateway.IndicatorGateway> indicatorStore
    ) {
        this.datasets = datasets;
        this.queryService = queryService;
        this.profileStore = profileStore;
        this.glossaryStore = glossaryStore;
        this.indicatorStore = indicatorStore;
    }

    /** 学习一个数据集：采样 → 统计 → 角色判定 → 写库。幂等：重复调用覆盖更新。 */
    public void learn(String datasetId) {
        learn(datasetId, () -> false, phase -> {});
    }

    public void learn(
            String datasetId,
            java.util.function.BooleanSupplier cancelled,
            java.util.function.Consumer<String> phase
    ) {
        try {
            DatasetDetailVO detail = datasets.get(datasetId).orElse(null);
            if (detail == null || detail.meta() == null || detail.fields() == null) return;
            String table = detail.meta().tableName();
            if (table == null || table.isBlank()) return;

            checkCancelled(cancelled);
            if (phase != null) phase.accept("sample");
            List<List<Object>> rows = sampleRows(datasetId, table);
            if (rows == null) return; // 采样失败（表不可达等），跳过学习，profile 接口仍走现场判定
            checkCancelled(cancelled);

            FieldProfileGateway store = profileStore.getIfAvailable();
            if (store == null) return; // stub 模式无 DB

            if (phase != null) phase.accept("stats");
            long now = System.currentTimeMillis();
            List<FieldProfileVO> saved = new ArrayList<>();
            for (DatasetFieldVO f : detail.fields()) {
                checkCancelled(cancelled);
                FieldProfileVO p = buildProfile(datasetId, f, rows, now);
                if (p != null) {
                    store.save(p);
                    saved.add(p);
                }
            }
            checkCancelled(cancelled);
            if (phase != null) phase.accept("extract");
            extractCommonDimensions(datasetId, saved);
            extractIndicators(datasetId, saved);
            log.info("[dataset-learn] dataset={} fields={} sampledRows={}", datasetId, detail.fields().size(), rows.size());
        } catch (java.util.concurrent.CancellationException e) {
            throw e;
        } catch (Exception e) {
            log.warn("[dataset-learn] failed dataset={}: {}", datasetId, e.getMessage());
        }
    }

    private static void checkCancelled(java.util.function.BooleanSupplier cancelled) {
        if (cancelled != null && cancelled.getAsBoolean()) {
            throw new java.util.concurrent.CancellationException("learn cancelled");
        }
    }

    /** 把低基数、语义可复用的 dim 字段抽为公共维度（type=dimension，含维度值）。 */
    private void extractCommonDimensions(String datasetId, List<FieldProfileVO> profiles) {
        io.opendashboard.domain.gateway.GlossaryGateway g = glossaryStore.getIfAvailable();
        if (g == null) return;
        for (FieldProfileVO p : profiles) {
            if (!"dim".equals(p.roleLearned())) continue;
            if (glossaryConfirmed(datasetId, p.fieldName())) continue;
            // 低基数（值可枚举）且非空值集合；distinct<=1 无区分度跳过
            if (p.distinctCount() == null || p.distinctCount() > 20 || p.distinctCount() <= 1) continue;
            List<Object> values = p.distinctValues();
            if (values == null || values.isEmpty()) continue;
            // 长文本/高基数排除：distinct 接近采样行数（30）说明近乎唯一，不是公共维度
            if (p.distinctCount() >= 25) continue;
            // 值本身超长（JSON/向量/大文本）排除
            boolean hasLongValue = false;
            for (Object v : values) {
                if (v != null && String.valueOf(v).length() > 80) {
                    hasLongValue = true;
                    break;
                }
            }
            if (hasLongValue) continue;
            // UUID / 毫秒时间戳类值排除（product/batch 的 uuid/时间戳值不是业务枚举）
            boolean techValue = false;
            for (Object v : values) {
                String s = String.valueOf(v);
                if (s.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                        || s.matches("\\d{13}") || s.matches("\\d{10}")) {
                    techValue = true;
                    break;
                }
            }
            if (techValue) continue;
            String term = shortTerm(p.fieldLabel() == null ? p.fieldName() : p.fieldLabel());
            if (term.isBlank()) term = p.fieldName();
            g.upsert(new io.opendashboard.domain.DatasetDtos.GlossaryUpsertRequest(
                    term,
                    "dimension",
                    datasetId,
                    p.fieldName(),
                    java.util.List.of(term),
                    values,
                    "candidate",
                    0.7,
                    "learned"
            ));
        }
    }

    /** 候选指标抽取：measure 字段 → de_indicator(draft)；agg 固定 SUM，业务名取字段 label。 */
    private void extractIndicators(String datasetId, List<FieldProfileVO> profiles) {
        io.opendashboard.domain.gateway.IndicatorGateway g = indicatorStore.getIfAvailable();
        if (g == null) return;
        for (FieldProfileVO p : profiles) {
            if (!"measure".equals(p.roleLearned())) continue;
            if (indicatorConfirmed(datasetId, p.fieldName())) continue;
            String label = p.fieldLabel() == null ? "" : p.fieldLabel();
            if (p.numericMin() != null && p.numericMax() != null
                    && p.numericMax() > 4_100_000_000_000L && p.numericMin() > 1_000_000_000_000L) {
                continue; // 毫秒级时间戳（1e12+），不是度量
            }
            if (Boolean.TRUE.equals(p.timestampLike())) continue;
            String businessName = shortTerm(label.isBlank() ? p.fieldName() : label);
            String agg = "SUM";
            String unit = null;
            g.upsert(new io.opendashboard.domain.DatasetDtos.IndicatorUpsertRequest(
                    datasetId, p.fieldName(), businessName, agg, unit, null, null, "draft", 0.5
            ));
            // 度量词表：term=字段 label，canonical=字段名，aliases 含原始字段名/label
            io.opendashboard.domain.gateway.GlossaryGateway gg = glossaryStore.getIfAvailable();
            if (gg != null) {
                List<String> aliases = new ArrayList<>();
                aliases.add(p.fieldName());
                if (!label.isBlank() && !label.equals(businessName)) aliases.add(label);
                gg.upsert(new io.opendashboard.domain.DatasetDtos.GlossaryUpsertRequest(
                        businessName, "metric", datasetId, p.fieldName(), aliases, null,
                        "candidate", 0.6, "learned"
                ));
            }
        }
    }

    /** 清洗出短维度名：去括号后缀/前缀（「状态：0-草稿」→「状态」）。 */
    private String shortTerm(String label) {
        String s = label == null ? "" : label.trim();
        // 去「状态：0-草稿」这类「名:值」前缀
        int colon = s.indexOf('：');
        if (colon <= 0) colon = s.indexOf(':');
        if (colon > 0 && colon < s.length() - 1) s = s.substring(0, colon);
        int paren = s.indexOf('(');
        if (paren > 0) s = s.substring(0, paren);
        return s.trim();
    }

    private boolean indicatorConfirmed(String datasetId, String fieldName) {
        io.opendashboard.domain.gateway.IndicatorGateway g = indicatorStore.getIfAvailable();
        if (g == null) return false;
        try {
            return g.findByField(datasetId, fieldName)
                    .map(it -> "confirmed".equals(it.status()))
                    .orElse(false);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean glossaryConfirmed(String datasetId, String fieldName) {
        io.opendashboard.domain.gateway.GlossaryGateway g = glossaryStore.getIfAvailable();
        if (g == null) return false;
        try {
            for (io.opendashboard.domain.DatasetDtos.GlossaryItemVO it : g.listByDataset(datasetId)) {
                if (fieldName.equals(it.canonicalField()) && "confirmed".equals(it.status())) {
                    return true;
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private List<List<Object>> sampleRows(String datasetId, String table) {
        try {
            DatasetQueryResult r = queryService.executeReadSql(
                    datasetId,
                    "SELECT * FROM " + table + " LIMIT " + SAMPLE_ROWS,
                    SAMPLE_ROWS
            );
            return r.rows() == null ? List.of() : r.rows();
        } catch (Exception e) {
            log.warn("[dataset-learn] sample failed {}: {}", datasetId, e.getMessage());
            return null;
        }
    }

    private FieldProfileVO buildProfile(String datasetId, DatasetFieldVO f, List<List<Object>> rows, long now) {
        String name = f.name();
        if (name == null || name.isBlank()) return null;
        // 找该列在采样行中的索引（按列顺序匹配 de_dataset_field 的 name）
        // 采样来自 SELECT *，列序 = 物理表列序；用 DatasetService 的字段顺序即可
        List<String> colNames = columnNames(rows);
        int idx = indexOfField(datasetId, name);
        if (idx < 0 || idx >= rows.getFirst().size()) return null;

        long distinct = 0;
        long nullCount = 0;
        Set<String> values = new LinkedHashSet<>();
        List<List<Object>> sample = new ArrayList<>();
        double min = Double.MAX_VALUE, max = -Double.MAX_VALUE;
        boolean numeric = "DECIMAL".equalsIgnoreCase(f.dataType()) || "INT".equalsIgnoreCase(f.dataType())
                || "BIGINT".equalsIgnoreCase(f.dataType()) || "FLOAT".equalsIgnoreCase(f.dataType())
                || "DOUBLE".equalsIgnoreCase(f.dataType());
        boolean isNum = numeric;

        for (int r = 0; r < rows.size(); r++) {
            List<Object> row = rows.get(r);
            Object v = idx < row.size() ? row.get(idx) : null;
            if (v == null || String.valueOf(v).isBlank()) {
                nullCount++;
                continue;
            }
            String sv = String.valueOf(v);
            distinct++;
            values.add(sv);
            if (sample.size() < 20) sample.add(List.of(sv));
            if (isNum) {
                try {
                    double d = Double.parseDouble(sv);
                    if (d < min) min = d;
                    if (d > max) max = d;
                } catch (NumberFormatException ignored) {
                    isNum = false;
                }
            }
        }

        // distinct 计数：用 values 集合大小（采样窗口内的近似 distinct）
        long distinctCount = values.size();
        double nullRate = rows.isEmpty() ? 0 : (double) nullCount / rows.size();

        // 角色判定：统计优先（确定性写闸）
        String role = decideRole(f, distinctCount, nullRate, values, isNum, min, max);

        List<Object> distinctValues = new ArrayList<>();
        if (distinctCount <= MAX_DISTINCT_VALUES) {
            distinctValues.addAll(values);
        } else if (isNum && min <= max) {
            distinctValues.add(min);
            distinctValues.add(max);
        }

        return new FieldProfileVO(
                datasetId, name, f.label(), f.dataType(),
                role, "stats",
                distinctCount, nullCount, nullRate,
                isNum ? min : null, isNum ? max : null,
                distinctValues,
                isTimeField(f),
                sample,
                now
        );
    }

    private String decideRole(
            DatasetFieldVO f, long distinct, double nullRate, Set<String> values,
            boolean numeric, double min, double max
    ) {
        // 1) 时间
        if (isTimeField(f)) return "time";

        // 2) 标志位：取值 ⊆ {0,1,y/n,true/false} 且低基数
        if (distinct <= 3 && lowCardinalityBoolean(values)) return "flag";

        // 3) ID：数值且采样窗口内几乎全唯一
        if (numeric && distinct >= 5 && isAllDistinct(values)) return "id";

        // 4) 度量：数值且非 id/flag
        if (numeric && distinct > 1) return "measure";

        // 5) 维度：字符串低基数
        if (distinct <= 200 && distinct > 0) return "dim";

        // 6) 其余
        return "junk";
    }

    private boolean isAllDistinct(Set<String> values) {
        // 采样 30 行内全部唯一 → 高概率标识符；阈值：distinct 接近行数
        return values.size() >= 20;
    }

    private boolean lowCardinalityBoolean(Set<String> values) {
        Set<String> low = new HashSet<>();
        for (String v : values) low.add(v.trim().toLowerCase(Locale.ROOT));
        return !low.isEmpty() && low.stream().allMatch(s -> s.equals("0") || s.equals("1")
                || s.equals("true") || s.equals("false") || s.equals("y") || s.equals("n")
                || s.equals("yes") || s.equals("no"));
    }

    private boolean isTimeField(DatasetFieldVO f) {
        if (f == null) return false;
        String g = f.group() == null ? "" : f.group().toLowerCase(Locale.ROOT);
        if (g.equals("t") || g.equals("time")) return true;
        String dt = f.dataType() == null ? "" : f.dataType().toUpperCase(Locale.ROOT);
        return dt.contains("DATE") || dt.contains("TIME") || dt.contains("TIMESTAMP");
    }

    private List<String> columnNames(List<List<Object>> rows) {
        return List.of(); // 由 indexOfField 用数据集字段顺序解析，不需要真实列名
    }

    private int indexOfField(String datasetId, String fieldName) {
        // 按 de_dataset_field 的顺序（与 SELECT * 列序一致的前提是字段全来自表列）
        // 这里用保守方式：取数据集字段列表，找 fieldName 的序号
        DatasetDetailVO detail = datasets.get(datasetId).orElse(null);
        if (detail == null || detail.fields() == null) return -1;
        for (int i = 0; i < detail.fields().size(); i++) {
            if (fieldName.equals(detail.fields().get(i).name())) return i;
        }
        return -1;
    }
}
