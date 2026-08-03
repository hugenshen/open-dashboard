package io.opendashboard.api;

import io.opendashboard.application.StubDashboardService;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.infrastructure.persistence.DashboardRepository;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class DashboardController {

    private final ObjectProvider<DashboardRepository> dashboardRepository;
    private final StubDashboardService stubDashboardService;

    public DashboardController(
            ObjectProvider<DashboardRepository> dashboardRepository,
            StubDashboardService stubDashboardService
    ) {
        this.dashboardRepository = dashboardRepository;
        this.stubDashboardService = stubDashboardService;
    }

    @GetMapping("/dashboard/{id}")
    public ResponseEntity<DashboardDetailVO> getDashboard(@PathVariable String id) {
        DashboardRepository repo = dashboardRepository.getIfAvailable();
        if (repo != null) {
            try {
                long numericId = Long.parseLong(id);
                return repo.findDetail(numericId)
                        .map(ResponseEntity::ok)
                        .orElseGet(() -> ResponseEntity.notFound().build());
            } catch (NumberFormatException e) {
                return ResponseEntity.badRequest().build();
            }
        }
        return stubDashboardService.findDetail(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
