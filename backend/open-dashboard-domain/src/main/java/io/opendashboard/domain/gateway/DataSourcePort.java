package io.opendashboard.domain.gateway;

import io.opendashboard.domain.DatasourceDtos.ColumnItem;
import io.opendashboard.domain.DatasourceDtos.TableItem;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.datasource.ConnectionSpec;

import java.util.List;

/** JDBC capability port for business datasources. */
public interface DataSourcePort {

    record PingResult(boolean ok, String message, long latencyMs, String errorType) {}

    record Agg(String field, String agg, String alias) {}

    PingResult ping(ConnectionSpec spec);

    List<String> listDatabases(ConnectionSpec spec);

    List<String> listSchemas(ConnectionSpec spec);

    List<TableItem> listTables(ConnectionSpec spec);

    List<ColumnItem> listColumns(ConnectionSpec spec, String table);

    DatasetQueryResult previewTable(ConnectionSpec spec, String table, int limit);

    DatasetQueryResult queryTable(
            ConnectionSpec spec,
            String table,
            List<String> dimensions,
            List<Agg> measures,
            List<String> columns,
            int limit
    );
}
