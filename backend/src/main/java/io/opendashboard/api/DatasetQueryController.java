package io.opendashboard.api;

import io.opendashboard.application.StubQueryService;
import io.opendashboard.domain.QueryDtos.DatasetQueryRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/datasetQuery")
public class DatasetQueryController {

    private final StubQueryService stubQueryService;

    public DatasetQueryController(StubQueryService stubQueryService) {
        this.stubQueryService = stubQueryService;
    }

    @PostMapping("/execute")
    public DatasetQueryResult execute(@RequestBody DatasetQueryRequest request) {
        return stubQueryService.execute(request);
    }
}
