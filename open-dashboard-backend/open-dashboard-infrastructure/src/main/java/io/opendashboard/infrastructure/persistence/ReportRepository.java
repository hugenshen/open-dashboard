package io.opendashboard.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.gateway.ReportGateway;
import io.opendashboard.domain.ReportDtos.ReportCreateRequest;
import io.opendashboard.domain.ReportDtos.ReportDetailVO;
import io.opendashboard.domain.ReportDtos.ReportDocUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaVO;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
@Profile("!stub")
public class ReportRepository implements ReportGateway {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ReportRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public List<ReportMetaVO> list(Integer limit) {
        String sql = """
                SELECT id, name, status, content_id, version, update_time
                FROM de_report
                ORDER BY update_time DESC NULLS LAST, id DESC
                """;
        if (limit != null && limit > 0) {
            int n = Math.min(limit, 50);
            return jdbc.query(sql + " LIMIT ?", (rs, rowNum) -> mapMeta(rs), n);
        }
        return jdbc.query(sql, (rs, rowNum) -> mapMeta(rs));
    }

    private ReportMetaVO mapMeta(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new ReportMetaVO(
                String.valueOf(rs.getLong("id")),
                rs.getString("name"),
                rs.getString("status"),
                String.valueOf(rs.getLong("content_id")),
                rs.getInt("version"),
                rs.getObject("update_time") == null ? null : rs.getLong("update_time")
        );
    }

    @Override
    public Optional<ReportDetailVO> get(String id) {
        long numericId = parseId(id);
        if (numericId < 0) {
            return Optional.empty();
        }
        List<ReportDetailVO> rows = jdbc.query(
                """
                SELECT id, name, status, content_id, version, update_time, content_json
                FROM de_report WHERE id = ?
                """,
                (rs, rowNum) -> new ReportDetailVO(
                        new ReportMetaVO(
                                String.valueOf(rs.getLong("id")),
                                rs.getString("name"),
                                rs.getString("status"),
                                String.valueOf(rs.getLong("content_id")),
                                rs.getInt("version"),
                                rs.getObject("update_time") == null ? null : rs.getLong("update_time")
                        ),
                        readJsonMap(rs.getString("content_json"))
                ),
                numericId
        );
        return rows.stream().findFirst();
    }

    @Override
    public ReportDetailVO create(ReportCreateRequest req) {
        long id = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) + 1 FROM de_report", Long.class);
        long now = System.currentTimeMillis();
        String name = req.name() == null || req.name().isBlank() ? "未命名报告" : req.name();
        Map<String, Object> content = emptyDoc();
        jdbc.update(
                """
                INSERT INTO de_report (id, name, status, content_id, version, content_json, create_time, update_time)
                VALUES (?, ?, 'draft', 1, 1, ?::jsonb, ?, ?)
                """,
                id,
                name,
                writeJson(content),
                now,
                now
        );
        return new ReportDetailVO(
                new ReportMetaVO(String.valueOf(id), name, "draft", "1", 1, now),
                content
        );
    }

    @Override
    public Optional<ReportMetaVO> updateMeta(String id, ReportMetaUpdateRequest req) {
        ReportDetailVO cur = get(id).orElse(null);
        if (cur == null) {
            return Optional.empty();
        }
        long numericId = parseId(id);
        String name = req.name() == null || req.name().isBlank() ? cur.meta().name() : req.name().trim();
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                UPDATE de_report SET name = ?, update_time = ? WHERE id = ?
                """,
                name,
                now,
                numericId
        );
        return get(id).map(ReportDetailVO::meta);
    }

    @Override
    public Optional<ReportDetailVO> updateDoc(String id, ReportDocUpdateRequest req) {
        ReportDetailVO cur = get(id).orElse(null);
        if (cur == null) {
            return Optional.empty();
        }
        if (req.contentId() != null && !req.contentId().equals(cur.meta().contentId())) {
            throw new IllegalStateException("contentId conflict");
        }
        long numericId = parseId(id);
        long nextContent = Long.parseLong(cur.meta().contentId()) + 1;
        long now = System.currentTimeMillis();
        Map<String, Object> content = req.content() == null ? emptyDoc() : req.content();
        int updated = jdbc.update(
                """
                UPDATE de_report
                SET content_json = ?::jsonb, content_id = ?, update_time = ?
                WHERE id = ? AND content_id = ?
                """,
                writeJson(content),
                nextContent,
                now,
                numericId,
                Long.parseLong(cur.meta().contentId())
        );
        if (updated == 0) {
            throw new IllegalStateException("contentId conflict");
        }
        return get(id);
    }

    @Override
    public Optional<ReportDetailVO> publish(String id) {
        ReportDetailVO cur = get(id).orElse(null);
        if (cur == null) {
            return Optional.empty();
        }
        long numericId = parseId(id);
        int nextVersion = cur.meta().version() + 1;
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                UPDATE de_report SET status = 'published', version = ?, update_time = ? WHERE id = ?
                """,
                nextVersion,
                now,
                numericId
        );
        return get(id);
    }

    private long parseId(String id) {
        try {
            return Long.parseLong(id);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private Map<String, Object> readJsonMap(String json) {
        if (json == null || json.isBlank()) {
            return emptyDoc();
        }
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return emptyDoc();
        }
    }

    private String writeJson(Map<String, Object> map) {
        try {
            return mapper.writeValueAsString(map);
        } catch (Exception e) {
            return "{}";
        }
    }

    private static Map<String, Object> emptyDoc() {
        Map<String, Object> text = new HashMap<>();
        text.put("type", "text");
        text.put("text", "在 Ribbon「工具」中使用「引用仪表盘」或「新建图表」插入实时图表。");
        Map<String, Object> paragraph = new HashMap<>();
        paragraph.put("type", "paragraph");
        paragraph.put("content", List.of(text));
        Map<String, Object> doc = new HashMap<>();
        doc.put("type", "doc");
        doc.put("content", new ArrayList<>(List.of(paragraph)));
        return doc;
    }
}
