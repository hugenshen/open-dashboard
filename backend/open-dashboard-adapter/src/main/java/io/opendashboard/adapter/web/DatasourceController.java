package io.opendashboard.adapter.web;

import io.opendashboard.application.DatasourceService;
import io.opendashboard.domain.DatasourceDtos.ColumnItem;
import io.opendashboard.domain.DatasourceDtos.DatasourceCreateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceProbeRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceUpdateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceVO;
import io.opendashboard.domain.DatasourceDtos.TableItem;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.gateway.DataSourcePort.PingResult;
import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.adapter.security.RequirePermission;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/datasource")
@RequireAuth
public class DatasourceController {

    private final DatasourceService service;

    public DatasourceController(DatasourceService service) {
        this.service = service;
    }

    @GetMapping
    public List<DatasourceVO> list() {
        return service.list();
    }

    @PostMapping
    @RequirePermission("datasource:manage")
    public DatasourceVO create(@RequestBody DatasourceCreateRequest request) {
        return service.create(request);
    }

    /** Unsaved probe for create wizard: ping / databases / schemas / tables / columns */
    @PostMapping("/probe")
    @RequirePermission("datasource:manage")
    public Map<String, Object> probe(@RequestBody DatasourceProbeRequest request) {
        return service.probe(request);
    }

    @GetMapping("/{id}")
    public ResponseEntity<DatasourceVO> get(@PathVariable String id) {
        return service.get(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PatchMapping("/{id}")
    @RequirePermission("datasource:manage")
    public ResponseEntity<DatasourceVO> update(@PathVariable String id, @RequestBody DatasourceUpdateRequest request) {
        return service.update(id, request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    @RequirePermission("datasource:manage")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        return service.delete(id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    @PostMapping("/{id}/ping")
    public ResponseEntity<Map<String, Object>> ping(@PathVariable String id) {
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        PingResult r = service.ping(id);
        return ResponseEntity.ok(Map.of(
                "ok", r.ok(),
                "message", r.message(),
                "latencyMs", r.latencyMs()
        ));
    }

    @GetMapping("/{id}/databases")
    public ResponseEntity<?> databases(@PathVariable String id) {
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        try {
            return ResponseEntity.ok(service.databases(id));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    @GetMapping("/{id}/schemas")
    public ResponseEntity<?> schemas(@PathVariable String id) {
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        try {
            return ResponseEntity.ok(service.schemas(id));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    @GetMapping("/{id}/tables")
    public ResponseEntity<?> tables(
            @PathVariable String id,
            @RequestParam(required = false) String schema
    ) {
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        try {
            return ResponseEntity.ok(service.tables(id, schema));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    @GetMapping("/{id}/tables/{table}/columns")
    public ResponseEntity<?> columns(
            @PathVariable String id,
            @PathVariable String table,
            @RequestParam(required = false) String schema
    ) {
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        try {
            List<ColumnItem> cols = service.columns(id, table, schema);
            return ResponseEntity.ok(cols);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    @PostMapping("/{id}/preview")
    @RequirePermission("datasource:manage")
    public ResponseEntity<?> preview(
            @PathVariable String id,
            @RequestBody Map<String, Object> body
    ) {
        if (service.get(id).isEmpty()) return ResponseEntity.notFound().build();
        Object tableObj = body.get("table");
        if (tableObj == null || String.valueOf(tableObj).isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "缺少 table"));
        }
        String schema = body.get("schema") == null ? null : String.valueOf(body.get("schema"));
        int limit = 50;
        if (body.get("limit") instanceof Number n) limit = n.intValue();
        try {
            DatasetQueryResult result = service.preview(id, String.valueOf(tableObj), schema, limit);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }
}
