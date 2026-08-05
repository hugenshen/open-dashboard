package io.opendashboard.adapter.web;

import io.opendashboard.application.ChartExportHelper;
import io.opendashboard.application.StubQueryService;
import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import io.opendashboard.adapter.security.RequireAuth;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api/chartQuery")
@RequireAuth
public class ChartQueryController {

    private final StubQueryService stubQueryService;

    public ChartQueryController(StubQueryService stubQueryService) {
        this.stubQueryService = stubQueryService;
    }

    @PostMapping("/query")
    public ChartQueryResult query(@RequestBody ChartQueryRequest request) {
        return stubQueryService.query(request);
    }

    /** 通用图表数据下载（CSV） */
    @PostMapping("/export")
    public ResponseEntity<byte[]> export(@RequestBody ChartQueryRequest request) {
        ChartQueryResult result = stubQueryService.query(request);
        byte[] csv = ChartExportHelper.toCsvBytes(result);
        String chartId = request.chartId() == null ? "chart" : request.chartId();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"chart-" + chartId + ".csv\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(csv);
    }
}
