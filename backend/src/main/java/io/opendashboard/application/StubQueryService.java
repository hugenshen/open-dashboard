package io.opendashboard.application;

import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import io.opendashboard.domain.QueryDtos.ColumnMeta;
import io.opendashboard.domain.QueryDtos.DatasetQueryRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.QueryDtos.FieldMeta;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class StubQueryService {

    public DatasetQueryResult execute(DatasetQueryRequest request) {
        long start = System.currentTimeMillis();
        List<ColumnMeta> columns = List.of(
                new ColumnMeta("region", "STRING", "region", null),
                new ColumnMeta("amount", "DECIMAL", "amount", "SUM")
        );
        List<List<Object>> rows = List.of(
                List.of("华东", 1200),
                List.of("华北", 980),
                List.of("华南", 760)
        );
        return new DatasetQueryResult(
                columns,
                rows,
                false,
                "-- stub: dataset=" + request.datasetId(),
                System.currentTimeMillis() - start
        );
    }

    public ChartQueryResult query(ChartQueryRequest request) {
        Map<String, Object> inline = request.inline();
        String datasetId = "stub-dataset";
        String chartType = "bar";
        if (inline != null) {
            Object ds = inline.get("datasetId");
            Object ct = inline.get("chartType");
            if (ds != null) {
                datasetId = String.valueOf(ds);
            }
            if (ct != null) {
                chartType = String.valueOf(ct);
            }
        }

        DatasetQueryRequest dsReq = new DatasetQueryRequest(
                datasetId,
                List.of(Map.of("field", "region")),
                List.of(Map.of("field", "amount", "agg", "SUM")),
                null,
                null,
                100,
                Map.of("includeSql", true)
        );
        DatasetQueryResult table = execute(dsReq);
        List<FieldMeta> fields = table.columns().stream()
                .map(c -> new FieldMeta(c.name(), c.dataType()))
                .toList();

        Map<String, Object> extra = new HashMap<>();
        extra.put("stub", true);
        extra.put("chartType", chartType);
        extra.put("chartId", request.chartId() == null ? "" : request.chartId());
        extra.put("dashboardId", request.dashboardId() == null ? "" : request.dashboardId());
        extra.put("inline", inline != null);
        if (request.dashboardId() == null && inline == null) {
            extra.put("error", "missing_chart_source");
        }

        return new ChartQueryResult(
                fields,
                table.rows(),
                Map.of(
                        "categories", List.of("华东", "华北", "华南"),
                        "series", List.of(Map.of("name", "amount", "data", List.of(1200, 980, 760)))
                ),
                extra
        );
    }
}
