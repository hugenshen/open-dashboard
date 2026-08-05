package io.opendashboard.domain;

import java.util.List;
import java.util.Map;

public final class DatasourceDtos {

    private DatasourceDtos() {}

    public record DatasourceVO(
            String id,
            String name,
            String type,
            String host,
            Integer port,
            String dbName,
            String schema,
            String username,
            boolean hasPassword,
            String status,
            Map<String, Object> ext,
            Long updateTime
    ) {}

    public record DatasourceCreateRequest(
            String name,
            String type,
            String host,
            Integer port,
            String dbName,
            String schema,
            String username,
            String password,
            Map<String, Object> ext
    ) {}

    public record DatasourceUpdateRequest(
            String name,
            String host,
            Integer port,
            String dbName,
            String schema,
            String username,
            String password,
            String status,
            Map<String, Object> ext
    ) {}

    /** Unsaved connection probe (create wizard). */
    public record DatasourceProbeRequest(
            String type,
            String host,
            Integer port,
            String dbName,
            String schema,
            String username,
            String password,
            /** ping | databases | schemas | tables | columns */
            String action,
            String table
    ) {}

    public record TableItem(String name, String comment) {}

    public record ColumnItem(String name, String dataType, String originType, String comment) {}
}
