package io.opendashboard.adapter.web;

import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.adapter.security.RequirePermission;
import io.opendashboard.application.conversation.QuestionService;
import io.opendashboard.domain.DatasetDtos.DatasetQuestionVO;
import io.opendashboard.domain.DatasetDtos.QuestionUpsertRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 高频问题（few-shot 示例）管理：数据集页维护「问题→标准 SQL」，SQLBot 生成时注入。
 */
@RestController
@RequestMapping("/api/dataset")
@RequireAuth
public class QuestionController {

    private final QuestionService service;

    public QuestionController(QuestionService service) {
        this.service = service;
    }

    @GetMapping("/{id}/questions")
    public List<DatasetQuestionVO> list(@PathVariable String id) {
        return service.listByDataset(id);
    }

    @PostMapping("/{id}/questions")
    @RequirePermission("dataset:manage")
    public ResponseEntity<DatasetQuestionVO> create(@PathVariable String id, @RequestBody QuestionUpsertRequest req) {
        QuestionUpsertRequest full = new QuestionUpsertRequest(
                id, req.question(), req.sql(), req.chartType(), req.brief(), req.status()
        );
        return service.create(full)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.badRequest().build());
    }

    @PutMapping("/{id}/questions/{qid}")
    @RequirePermission("dataset:manage")
    public ResponseEntity<DatasetQuestionVO> update(
            @PathVariable String id, @PathVariable Long qid, @RequestBody QuestionUpsertRequest req
    ) {
        QuestionUpsertRequest full = new QuestionUpsertRequest(
                id, req.question(), req.sql(), req.chartType(), req.brief(), req.status()
        );
        return service.update(qid, full)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/questions/{qid}/toggle")
    @RequirePermission("dataset:manage")
    public ResponseEntity<DatasetQuestionVO> toggle(@PathVariable Long qid, @RequestBody Map<String, Object> body) {
        String status = body == null ? null : body.get("status") == null ? null : String.valueOf(body.get("status"));
        return service.toggle(qid, status)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}/questions/{qid}")
    @RequirePermission("dataset:manage")
    public ResponseEntity<Void> delete(@PathVariable Long qid) {
        return service.delete(qid) ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }
}
