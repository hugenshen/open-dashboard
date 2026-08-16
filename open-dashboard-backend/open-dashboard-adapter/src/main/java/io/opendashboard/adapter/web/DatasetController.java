package io.opendashboard.adapter.web;

import io.opendashboard.application.DatasetService;
import io.opendashboard.domain.DatasetDtos.DatasetCreateRequest;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.DatasetDtos.DatasetUpdateRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.adapter.security.RequirePermission;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/dataset")
@RequireAuth
public class DatasetController {

    private final DatasetService service;

    public DatasetController(DatasetService service) {
        this.service = service;
    }

    @GetMapping
    public List<DatasetMetaVO> list() {
        return service.list();
    }

    @PostMapping
    @RequirePermission("dataset:manage")
    public DatasetDetailVO create(@RequestBody DatasetCreateRequest request) {
        return service.create(request);
    }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequirePermission("dataset:manage")
    public DatasetDetailVO importFile(@RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择 CSV 或 Excel 文件");
        }
        try {
            return service.importFile(file.getOriginalFilename(), file.getBytes());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无法读取文件: " + e.getMessage());
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<DatasetDetailVO> get(@PathVariable String id) {
        return service.get(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PatchMapping("/{id}")
    @RequirePermission("dataset:manage")
    public ResponseEntity<DatasetDetailVO> update(@PathVariable String id, @RequestBody DatasetUpdateRequest request) {
        return service.update(id, request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/fields")
    @RequirePermission("dataset:manage")
    public ResponseEntity<DatasetDetailVO> putFields(@PathVariable String id, @RequestBody List<DatasetFieldVO> fields) {
        return service.putFields(id, fields).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    @RequirePermission("dataset:manage")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        return service.delete(id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    @PostMapping("/{id}/preview")
    public ResponseEntity<DatasetQueryResult> preview(@PathVariable String id) {
        return service.preview(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }
}
