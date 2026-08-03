package io.opendashboard.api;

import io.opendashboard.application.StubQueryService;
import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/chartQuery")
public class ChartQueryController {

    private final StubQueryService stubQueryService;

    public ChartQueryController(StubQueryService stubQueryService) {
        this.stubQueryService = stubQueryService;
    }

    @PostMapping("/query")
    public ChartQueryResult query(@RequestBody ChartQueryRequest request) {
        return stubQueryService.query(request);
    }
}
