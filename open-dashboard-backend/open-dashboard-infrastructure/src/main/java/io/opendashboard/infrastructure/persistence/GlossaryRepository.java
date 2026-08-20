package io.opendashboard.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.DatasetDtos.GlossaryItemVO;
import io.opendashboard.domain.DatasetDtos.GlossaryUpsertRequest;
import io.opendashboard.domain.gateway.GlossaryGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Repository
@Profile("!stub")
public class GlossaryRepository implements GlossaryGateway {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public GlossaryRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public GlossaryItemVO upsert(GlossaryUpsertRequest req) {
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                INSERT INTO de_glossary (term, type, dataset_id, canonical_field, aliases, values_json, status, source, confidence, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?)
                ON CONFLICT (term, dataset_id) DO UPDATE SET
                  type = EXCLUDED.type,
                  canonical_field = EXCLUDED.canonical_field,
                  aliases = EXCLUDED.aliases,
                  values_json = EXCLUDED.values_json,
                  confidence = EXCLUDED.confidence,
                  updated_at = EXCLUDED.updated_at
                WHERE de_glossary.status IS DISTINCT FROM 'confirmed'
                """,
                req.term(), req.type(), req.datasetId(), req.canonicalField(),
                writeJson(req.aliases() == null ? List.of() : req.aliases()),
                writeJson(req.values() == null ? List.of() : req.values()),
                req.status() == null ? "candidate" : req.status(),
                req.source() == null ? "learned" : req.source(),
                req.confidence() == null ? 0.5 : req.confidence(),
                now, now
        );
        return findByTermDataset(req.term(), req.datasetId()).orElse(null);
    }

    @Override
    public List<GlossaryItemVO> list(String type, String status) {
        StringBuilder sql = new StringBuilder(
                "SELECT id, term, type, dataset_id, canonical_field, aliases, values_json, status, source, confidence, created_at, updated_at FROM de_glossary WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (type != null && !type.isBlank()) {
            sql.append(" AND type = ?");
            args.add(type);
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            args.add(status);
        }
        sql.append(" ORDER BY type, status, term");
        return jdbc.query(sql.toString(), (rs, i) -> map(rs), args.toArray());
    }

    @Override
    public List<GlossaryItemVO> listByDataset(String datasetId) {
        return jdbc.query(
                "SELECT id, term, type, dataset_id, canonical_field, aliases, values_json, status, source, confidence, created_at, updated_at FROM de_glossary WHERE dataset_id = ? ORDER BY type, term",
                (rs, i) -> map(rs), datasetId
        );
    }

    @Override
    public Optional<GlossaryItemVO> find(Long id) {
        List<GlossaryItemVO> rows = jdbc.query(
                "SELECT id, term, type, dataset_id, canonical_field, aliases, values_json, status, source, confidence, created_at, updated_at FROM de_glossary WHERE id = ?",
                (rs, i) -> map(rs), id
        );
        return rows.stream().findFirst();
    }

    @Override
    public Optional<GlossaryItemVO> updateStatus(Long id, String status) {
        jdbc.update("UPDATE de_glossary SET status = ?, updated_at = ? WHERE id = ?", status, System.currentTimeMillis(), id);
        return find(id);
    }

    @Override
    public Optional<GlossaryItemVO> updateName(Long id, String term, List<String> aliases) {
        jdbc.update(
                "UPDATE de_glossary SET term = ?, aliases = ?::jsonb, updated_at = ? WHERE id = ?",
                term, writeJson(aliases == null ? List.of() : aliases), System.currentTimeMillis(), id
        );
        return find(id);
    }

    @Override
    public Optional<GlossaryItemVO> updateValues(Long id, List<Object> values) {
        jdbc.update(
                "UPDATE de_glossary SET values_json = ?::jsonb, updated_at = ? WHERE id = ?",
                writeJson(values == null ? List.of() : values), System.currentTimeMillis(), id
        );
        return find(id);
    }

    @Override
    public boolean delete(Long id) {
        return jdbc.update("DELETE FROM de_glossary WHERE id = ?", id) > 0;
    }

    private Optional<GlossaryItemVO> findByTermDataset(String term, String datasetId) {
        List<GlossaryItemVO> rows = jdbc.query(
                "SELECT id, term, type, dataset_id, canonical_field, aliases, values_json, status, source, confidence, created_at, updated_at FROM de_glossary WHERE term = ? AND dataset_id = ?",
                (rs, i) -> map(rs), term, datasetId
        );
        return rows.stream().findFirst();
    }

    private GlossaryItemVO map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new GlossaryItemVO(
                rs.getLong("id"),
                rs.getString("term"),
                rs.getString("type"),
                rs.getString("dataset_id"),
                rs.getString("canonical_field"),
                readStrings(rs.getString("aliases")),
                readList(rs.getString("values_json")),
                rs.getString("status"),
                rs.getString("source"),
                rs.getDouble("confidence"),
                rs.getLong("created_at"),
                rs.getLong("updated_at")
        );
    }

    private List<Object> readList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private List<String> readStrings(String json) {
        List<Object> raw = readList(json);
        List<String> out = new ArrayList<>();
        for (Object o : raw) {
            if (o != null) out.add(String.valueOf(o));
        }
        return out;
    }

    private String writeJson(Object value) {
        try {
            return mapper.writeValueAsString(value == null ? List.of() : value);
        } catch (Exception e) {
            return "[]";
        }
    }
}
