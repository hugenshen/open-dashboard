package io.opendashboard.adapter.web;

import io.opendashboard.domain.gateway.ReportGateway;
import io.opendashboard.domain.ReportDtos.ReportCreateRequest;
import io.opendashboard.domain.ReportDtos.ReportDetailVO;
import io.opendashboard.domain.ReportDtos.ReportDocUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaVO;
import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.adapter.security.RequirePermission;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/report")
@RequireAuth
public class ReportController {

    private final ReportGateway store;

    public ReportController(ReportGateway store) {
        this.store = store;
    }

    @GetMapping
    public List<ReportMetaVO> list() {
        return store.list();
    }

    @PostMapping
    @RequirePermission("report:manage")
    public ReportDetailVO create(@RequestBody(required = false) ReportCreateRequest request) {
        return store.create(request == null ? new ReportCreateRequest("未命名报告") : request);
    }

    @GetMapping("/{id}")
    public ResponseEntity<ReportDetailVO> get(@PathVariable String id) {
        return store.get(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PatchMapping("/{id}")
    @RequirePermission("report:manage")
    public ResponseEntity<ReportMetaVO> updateMeta(
            @PathVariable String id,
            @RequestBody ReportMetaUpdateRequest request
    ) {
        return store.updateMeta(id, request == null ? new ReportMetaUpdateRequest(null, null, null) : request)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/doc")
    @RequirePermission("report:manage")
    public ResponseEntity<?> updateDoc(@PathVariable String id, @RequestBody ReportDocUpdateRequest request) {
        try {
            return store.updateDoc(id, request)
                    .<ResponseEntity<?>>map(ResponseEntity::ok)
                    .orElseGet(() -> ResponseEntity.notFound().build());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", e.getMessage()));
        }
    }

    @PostMapping("/{id}/publish")
    @RequirePermission("report:manage")
    public ResponseEntity<ReportDetailVO> publish(@PathVariable String id) {
        return store.publish(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }
}
