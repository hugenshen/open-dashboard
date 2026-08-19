package io.opendashboard.adapter.web;

import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.adapter.security.RequirePermission;
import io.opendashboard.application.conversation.KnowledgeService;
import io.opendashboard.domain.DatasetDtos.IndicatorUpsertRequest;
import io.opendashboard.domain.DatasetDtos.IndicatorVO;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 指标注册表管理（阶段2「指标确认」tab）：列表、手动新增、draft→confirmed、作废、删除。
 */
@RestController
@RequestMapping("/api/indicators")
@RequireAuth
public class IndicatorController {

    private final KnowledgeService service;

    public IndicatorController(KnowledgeService service) {
        this.service = service;
    }

    @GetMapping
    public List<IndicatorVO> list(@RequestParam(required = false) String datasetId) {
        return datasetId == null || datasetId.isBlank() ? List.of() : service.listIndicators(datasetId);
    }

    @GetMapping("/dataset/{datasetId}")
    public List<IndicatorVO> byDataset(@PathVariable String datasetId) {
        return service.listIndicators(datasetId);
    }

    @PostMapping
    @RequirePermission("dataset:manage")
    public ResponseEntity<IndicatorVO> create(@RequestBody IndicatorUpsertRequest req) {
        return service.createIndicator(req)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.internalServerError().build());
    }

    @PostMapping("/{id}/confirm")
    @RequirePermission("dataset:manage")
    public ResponseEntity<IndicatorVO> confirm(@PathVariable Long id) {
        return service.confirm(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/deprecate")
    @RequirePermission("dataset:manage")
    public ResponseEntity<IndicatorVO> deprecate(@PathVariable Long id) {
        return service.deprecate(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    @RequirePermission("dataset:manage")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        return service.deleteIndicator(id) ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }
}
