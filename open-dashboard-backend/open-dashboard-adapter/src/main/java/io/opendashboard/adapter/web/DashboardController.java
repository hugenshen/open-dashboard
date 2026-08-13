package io.opendashboard.adapter.web;

import io.opendashboard.application.DashboardAppService;
import io.opendashboard.domain.DashboardDtos.BusiNodeRequest;
import io.opendashboard.domain.DashboardDtos.BusiNodeVO;
import io.opendashboard.domain.DashboardDtos.ChartViewSaveRequest;
import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardBarVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentsUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardCreateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutVO;
import io.opendashboard.domain.DashboardDtos.DashboardLinkageVO;
import io.opendashboard.domain.DashboardDtos.DashboardMoveRequest;
import io.opendashboard.domain.DashboardDtos.DashboardNodeVO;
import io.opendashboard.domain.DashboardDtos.DashboardRenameRequest;
import io.opendashboard.domain.DashboardDtos.DashboardShareVO;
import io.opendashboard.domain.DashboardDtos.DashboardStatusVO;
import io.opendashboard.domain.DashboardDtos.DashboardTemplateVO;
import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.adapter.security.RequirePermission;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@RequireAuth
public class DashboardController {

    private final DashboardAppService service;

    public DashboardController(DashboardAppService service) {
        this.service = service;
    }

    @GetMapping("/dashboard/templates")
    public List<DashboardTemplateVO> listTemplates() {
        return service.listTemplates();
    }

    @GetMapping("/dashboard/{id}")
    public ResponseEntity<DashboardDetailVO> getDashboard(
            @PathVariable String id,
            @RequestParam(defaultValue = "draft") String view
    ) {
        return service.get(id, view).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/dashboard/{id}/layout")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<DashboardLayoutVO> updateLayout(
            @PathVariable String id,
            @RequestBody DashboardLayoutUpdateRequest request
    ) {
        return service.updateLayout(id, request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/dashboard/{id}/components")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<List<DashboardComponentVO>> updateComponents(
            @PathVariable String id,
            @RequestBody DashboardComponentsUpdateRequest request
    ) {
        return service.updateComponents(id, request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/dashboard/{id}/charts/{chartId}")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<ChartViewVO> saveChart(
            @PathVariable String id,
            @PathVariable String chartId,
            @RequestBody ChartViewSaveRequest request
    ) {
        return service.saveChart(id, chartId, request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/dashboard/{id}/charts/{chartId}")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<Void> deleteChart(
            @PathVariable String id,
            @PathVariable String chartId
    ) {
        return service.deleteChart(id, chartId) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    @PostMapping("/dashboard/{id}/publish")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<DashboardStatusVO> publish(@PathVariable String id) {
        return service.publish(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/dashboard/{id}/discardDraft")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<DashboardStatusVO> discardDraft(@PathVariable String id) {
        return service.discardDraft(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/dashboard/{id}/status")
    public ResponseEntity<DashboardStatusVO> status(@PathVariable String id) {
        return service.status(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/dashboard/{id}/linkages")
    public ResponseEntity<List<DashboardLinkageVO>> getLinkages(
            @PathVariable String id,
            @RequestParam(defaultValue = "draft") String view
    ) {
        return service.getLinkages(id, view).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/dashboard/{id}/linkages")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<List<DashboardLinkageVO>> putLinkages(
            @PathVariable String id,
            @RequestBody List<DashboardLinkageVO> linkages
    ) {
        return service.putLinkages(id, linkages).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/dashboard/{id}/share")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<DashboardShareVO> share(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, String> body
    ) {
        return service.share(id, body).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/dashboard/{id}/share")
    public ResponseEntity<DashboardShareVO> getShare(@PathVariable String id) {
        return service.getShare(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/dashboardTree/tree")
    public List<BusiNodeVO> tree(@RequestBody(required = false) BusiNodeRequest request) {
        return service.tree();
    }

    @PostMapping("/dashboardTree/create")
    @RequirePermission("dashboard:manage")
    public DashboardNodeVO create(@RequestBody DashboardCreateRequest request) {
        return service.create(request);
    }

    @PostMapping("/dashboardTree/rename")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<DashboardNodeVO> rename(@RequestBody DashboardRenameRequest request) {
        return service.rename(request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/dashboardTree/move")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<DashboardNodeVO> move(@RequestBody DashboardMoveRequest request) {
        return service.move(request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/dashboardTree/delete/{id}")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        return service.delete(id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /** Same as hard delete for now; soft-delete / recycle can diverge later. */
    @PostMapping("/dashboardTree/perDelete/{id}")
    @RequirePermission("dashboard:manage")
    public ResponseEntity<Boolean> perDelete(@PathVariable String id) {
        return service.delete(id) ? ResponseEntity.ok(true) : ResponseEntity.notFound().build();
    }

    @GetMapping("/dashboardTree/barInfo/{id}")
    public ResponseEntity<DashboardBarVO> barInfo(@PathVariable String id) {
        return service.barInfo(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }
}
