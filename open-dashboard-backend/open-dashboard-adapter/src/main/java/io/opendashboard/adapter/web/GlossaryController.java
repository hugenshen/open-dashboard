package io.opendashboard.adapter.web;

import io.opendashboard.application.conversation.GlossaryService;
import io.opendashboard.domain.DatasetDtos.GlossaryItemVO;
import io.opendashboard.domain.DatasetDtos.GlossaryUpsertRequest;
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

/**
 * 公共维度 / 业务词表管理（阶段2「维度管理」菜单）。
 */
@RestController
@RequestMapping("/api/glossary")
@RequireAuth
public class GlossaryController {

    private final GlossaryService service;

    public GlossaryController(GlossaryService service) {
        this.service = service;
    }

    @GetMapping
    public List<GlossaryItemVO> list(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String status
    ) {
        return service.list(type, status);
    }

    @GetMapping("/dataset/{datasetId}")
    public List<GlossaryItemVO> byDataset(@PathVariable String datasetId) {
        return service.listByDataset(datasetId);
    }

    @PostMapping
    @RequirePermission("dataset:manage")
    public ResponseEntity<GlossaryItemVO> upsert(@RequestBody GlossaryUpsertRequest req) {
        return service.upsert(req)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.internalServerError().build());
    }

    @PostMapping("/{id}/confirm")
    public ResponseEntity<GlossaryItemVO> confirm(@PathVariable Long id) {
        return service.confirm(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/values")
    public ResponseEntity<GlossaryItemVO> updateValues(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<Object> values = body != null && body.get("values") instanceof List<?> raw ? new java.util.ArrayList<>(raw) : List.of();
        return service.updateValues(id, values)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** 数据集字段维度值配置：无词条新建（term=label），有则更新 values_json。 */
    @PostMapping("/field-values")
    public ResponseEntity<GlossaryItemVO> configureFieldValues(@RequestBody Map<String, Object> body) {
        String datasetId = body == null ? null : body.get("datasetId") == null ? null : String.valueOf(body.get("datasetId"));
        String fieldName = body == null ? null : body.get("fieldName") == null ? null : String.valueOf(body.get("fieldName"));
        String label = body == null ? null : body.get("label") == null ? null : String.valueOf(body.get("label"));
        @SuppressWarnings("unchecked")
        List<Object> values = body != null && body.get("values") instanceof List<?> raw ? new java.util.ArrayList<>(raw) : List.of();
        return service.configureFieldValues(datasetId, fieldName, label, values)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.badRequest().build());
    }

    @PutMapping("/{id}/rename")
    public ResponseEntity<GlossaryItemVO> rename(
            @PathVariable Long id,
            @RequestBody Map<String, Object> body
    ) {
        String term = body == null ? null : body.get("term") == null ? null : String.valueOf(body.get("term"));
        @SuppressWarnings("unchecked")
        List<String> aliases = body != null && body.get("aliases") instanceof List<?> raw
                ? raw.stream().map(String::valueOf).toList() : List.of();
        return service.rename(id, term, aliases)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    @RequirePermission("dataset:manage")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        return service.delete(id) ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }
}
