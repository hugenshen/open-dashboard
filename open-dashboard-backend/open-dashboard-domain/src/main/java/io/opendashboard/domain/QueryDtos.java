package io.opendashboard.domain;

import java.util.List;
import java.util.Map;

public final class QueryDtos {

    private QueryDtos() {}

    public record ChartQueryRequest(
            String chartId,
            String dashboardId,
            String view,
            Map<String, Object> inline,
            Map<String, Object> context
    ) {}

    public record FieldMeta(String name, String type) {}

    public record ChartQueryResult(
            List<FieldMeta> fields,
            List<List<Object>> data,
            Map<String, Object> series,
            Map<String, Object> extra
    ) {}

    public record DatasetQueryRequest(
            String datasetId,
            List<Map<String, Object>> dimensions,
            List<Map<String, Object>> measures,
            List<String> columns,
            Map<String, Object> filters,
            Integer limit,
            Map<String, Object> options
    ) {}

    public record ColumnMeta(String name, String dataType, String field, String agg) {}

    public record DatasetQueryResult(
            List<ColumnMeta> columns,
            List<List<Object>> rows,
            boolean truncated,
            String sql,
            long elapsedMs
    ) {}
}
