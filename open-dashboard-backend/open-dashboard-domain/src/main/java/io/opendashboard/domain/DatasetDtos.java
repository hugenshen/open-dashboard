package io.opendashboard.domain;

import java.util.List;

public final class DatasetDtos {

    private DatasetDtos() {}

    public record DatasetFieldVO(
            String name,
            String label,
            String group,
            String dataType,
            String origin,
            String expression
    ) {
        public DatasetFieldVO {
            if (origin == null || origin.isBlank()) origin = "table";
        }

        /** Table-column field without expression (common constructor). */
        public DatasetFieldVO(String name, String label, String group, String dataType) {
            this(name, label, group, dataType, "table", null);
        }
    }

    public record DatasetMetaVO(
            String id,
            String name,
            String folder,
            String datasourceId,
            String tableName,
            String status,
            Long updateTime
    ) {}

    public record DatasetDetailVO(
            DatasetMetaVO meta,
            List<DatasetFieldVO> fields
    ) {}

    /** 字段自学习画像（阶段1：统计特征 + 学习角色 + 采样）。 */
    public record FieldProfileVO(
            String datasetId,
            String fieldName,
            String fieldLabel,
            String dataType,
            String roleLearned,       // dim | measure | time | flag | id | junk | text
            String roleSource,        // stats | naming | both | manual
            Long distinctCount,
            Long nullCount,
            Double nullRate,
            Double numericMin,
            Double numericMax,
            List<Object> distinctValues,  // 低基数取值集合；高基数 [min,max] 两元素
            Boolean timestampLike,
            List<List<Object>> sample,    // 该字段 ≤20 行真实采样
            Long learnedAt
    ) {}

    public record DatasetCreateRequest(
            String name,
            String folder,
            String datasourceId,
            String tableName,
            List<DatasetFieldVO> fields
    ) {}

    public record DatasetUpdateRequest(
            String name,
            String folder,
            String tableName,
            String status
    ) {}

    /** 指标注册表条目（de_indicator）：候选 + 已确认，agg/unit/口径权威。 */
    public record IndicatorVO(
            Long id,
            String datasetId,
            String fieldName,
            String name,               // 业务名「消费金额」
            String agg,                // SUM | AVG | COUNT | MIN | MAX
            String unit,               // 元 | 万元 | % | 件 …
            String formula,            // 口径说明
            String description,
            String status,             // draft | confirmed | deprecated
            String source,             // learned | manual
            Double confidence,         // 0-1
            Long createdAt,
            Long updatedAt
    ) {}

    public record IndicatorUpsertRequest(
            String datasetId,
            String fieldName,
            String name,
            String agg,
            String unit,
            String formula,
            String description,
            String status,
            Double confidence
    ) {}

    /** od_interpret_fields 的单字段语义解释（LLM 输出，回写 indicator confidence）。 */
    public record FieldInterpretVO(
            String field,
            String role,               // dim | measure | time | flag | id | junk | text
            String businessMeaning,
            Boolean aggregatable,
            List<String> aliases,
            String suggestedAgg,
            Double confidence
    ) {}

    /** 高频问题（de_dataset_question）：few-shot 示例，SQLBot 生成 SQL 时注入。 */
    public record DatasetQuestionVO(
            Long id,
            String datasetId,
            String question,
            String sql,
            String chartType,
            String brief,
            String status,             // active | disabled
            Integer hitCount,
            Long createdAt,
            Long updatedAt
    ) {}

    public record QuestionUpsertRequest(
            String datasetId,
            String question,
            String sql,
            String chartType,
            String brief,
            String status
    ) {}

    /** 业务词表 / 公共维度条目（de_glossary）。 */
    public record GlossaryItemVO(
            Long id,
            String term,
            String type,               // metric | dimension | entity | flag
            String datasetId,
            String canonicalField,
            List<String> aliases,
            List<Object> values,       // 维度枚举值（type=dimension 时）
            String status,             // candidate | confirmed | merged | deprecated
            String source,             // learned | manual
            Double confidence,
            Long createdAt,
            Long updatedAt
    ) {}

    public record GlossaryUpsertRequest(
            String term,
            String type,
            String datasetId,
            String canonicalField,
            List<String> aliases,
            List<Object> values,
            String status,
            Double confidence,
            String source
    ) {
        public GlossaryUpsertRequest {
            if (source == null || source.isBlank()) source = "learned";
        }
    }
}
