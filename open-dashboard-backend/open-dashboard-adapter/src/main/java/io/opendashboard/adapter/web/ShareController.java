package io.opendashboard.adapter.web;

import io.opendashboard.application.ChartExportHelper;
import io.opendashboard.application.DashboardAppService;
import io.opendashboard.application.StubQueryService;
import io.opendashboard.domain.DashboardDtos.DashboardShareVO;
import io.opendashboard.domain.DashboardDtos.ShareViewVO;
import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * 公开分享访问（无类级 @RequireAuth）：凭 token 查看已发布仪表盘、查询与下载图表数据。
 */
@RestController
@RequestMapping("/api/share")
public class ShareController {

    private final DashboardAppService dashboardAppService;
    private final StubQueryService stubQueryService;

    public ShareController(DashboardAppService dashboardAppService, StubQueryService stubQueryService) {
        this.dashboardAppService = dashboardAppService;
        this.stubQueryService = stubQueryService;
    }

    @GetMapping("/{token}")
    public ResponseEntity<ShareViewVO> view(@PathVariable String token) {
        return dashboardAppService.resolveShareView(token)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/{token}/chartQuery")
    public ResponseEntity<ChartQueryResult> chartQuery(
            @PathVariable String token,
            @RequestBody ChartQueryRequest request
    ) {
        DashboardShareVO share = requireShare(token);
        if (share == null) {
            return ResponseEntity.notFound().build();
        }
        ChartQueryRequest bound = new ChartQueryRequest(
                request.chartId(),
                share.dashboardId(),
                "published",
                request.inline(),
                request.context() == null ? Map.of() : request.context()
        );
        return ResponseEntity.ok(stubQueryService.query(bound));
    }

    @PostMapping("/{token}/export")
    public ResponseEntity<byte[]> export(
            @PathVariable String token,
            @RequestBody Map<String, String> body
    ) {
        DashboardShareVO share = requireShare(token);
        if (share == null) {
            return ResponseEntity.notFound().build();
        }
        String chartId = body == null ? null : body.get("chartId");
        if (chartId == null || chartId.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        ChartQueryRequest req = new ChartQueryRequest(
                chartId,
                share.dashboardId(),
                "published",
                null,
                Map.of("filters", java.util.List.of(), "linkages", java.util.List.of())
        );
        ChartQueryResult result = stubQueryService.query(req);
        byte[] csv = ChartExportHelper.toCsvBytes(result);
        String filename = "chart-" + chartId + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(csv);
    }

    private DashboardShareVO requireShare(String token) {
        return dashboardAppService.findShareByToken(token)
                .filter(DashboardShareVO::enabled)
                .filter(s -> s.expireAt() == null || s.expireAt() <= 0 || s.expireAt() >= System.currentTimeMillis())
                .orElse(null);
    }
}
