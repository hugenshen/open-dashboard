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
}
