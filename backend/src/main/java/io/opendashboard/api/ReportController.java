package io.opendashboard.api;

import io.opendashboard.application.InMemoryReportStore;
import io.opendashboard.domain.ReportDtos.ReportCreateRequest;
import io.opendashboard.domain.ReportDtos.ReportDetailVO;
import io.opendashboard.domain.ReportDtos.ReportDocUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaVO;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
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
public class ReportController {

    private final InMemoryReportStore store;

    public ReportController(InMemoryReportStore store) {
        this.store = store;
    }

    @GetMapping
    public List<ReportMetaVO> list() {
        return store.list();
    }

    @PostMapping
    public ReportDetailVO create(@RequestBody(required = false) ReportCreateRequest request) {
        return store.create(request == null ? new ReportCreateRequest("未命名报告") : request);
    }

    @GetMapping("/{id}")
    public ResponseEntity<ReportDetailVO> get(@PathVariable String id) {
        return store.get(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/doc")
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
    public ResponseEntity<ReportDetailVO> publish(@PathVariable String id) {
        return store.publish(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }
}
