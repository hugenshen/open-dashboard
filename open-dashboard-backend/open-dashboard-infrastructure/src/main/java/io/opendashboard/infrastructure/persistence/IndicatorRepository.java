package io.opendashboard.infrastructure.persistence;

import io.opendashboard.domain.DatasetDtos.IndicatorUpsertRequest;
import io.opendashboard.domain.DatasetDtos.IndicatorVO;
import io.opendashboard.domain.gateway.IndicatorGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * JDBC storage for indicator registry (de_indicator).
 * Same conventions as GlossaryRepository / FieldProfileRepository.
 */
@Repository
@Profile("!stub")
public class IndicatorRepository implements IndicatorGateway {

    private static final String COLS =
            "id, dataset_id, field_name, name, agg, unit, formula, description, status, source, confidence, created_at, updated_at";

    private final JdbcTemplate jdbc;

    public IndicatorRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public IndicatorVO upsert(IndicatorUpsertRequest req) {
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                INSERT INTO de_indicator
                (dataset_id, field_name, name, agg, unit, formula, description, status, source, confidence, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (dataset_id, field_name, name) DO UPDATE SET
                  agg = EXCLUDED.agg,
                  unit = EXCLUDED.unit,
                  formula = EXCLUDED.formula,
                  description = EXCLUDED.description,
                  status = EXCLUDED.status,
                  confidence = EXCLUDED.confidence,
                  updated_at = EXCLUDED.updated_at
                WHERE de_indicator.status IS DISTINCT FROM 'confirmed'
                """,
                req.datasetId(), req.fieldName(), req.name(), req.agg(), req.unit(), req.formula(), req.description(),
                req.status() == null ? "draft" : req.status(),
                "learned",
                req.confidence() == null ? 0.5 : req.confidence(),
                now, now
        );
        return findByField(req.datasetId(), req.fieldName()).orElse(null);
    }

    @Override
    public List<IndicatorVO> listByDataset(String datasetId) {
        return jdbc.query(
                "SELECT " + COLS + " FROM de_indicator WHERE dataset_id = ? ORDER BY status, confidence DESC, id",
                (rs, i) -> map(rs), datasetId
        );
    }

    @Override
    public List<IndicatorVO> listConfirmed(String datasetId) {
        return jdbc.query(
                "SELECT " + COLS + " FROM de_indicator WHERE dataset_id = ? AND status = 'confirmed' ORDER BY confidence DESC, id",
                (rs, i) -> map(rs), datasetId
        );
    }

    @Override
    public List<IndicatorVO> listConfirmedForDatasets(List<String> datasetIds) {
        if (datasetIds == null || datasetIds.isEmpty()) return List.of();
        String in = String.join(",", datasetIds.stream().map(s -> "?").toList());
        List<Object> args = new ArrayList<>(datasetIds);
        return jdbc.query(
                "SELECT " + COLS + " FROM de_indicator WHERE status = 'confirmed' AND dataset_id IN (" + in + ") ORDER BY dataset_id, confidence DESC",
                (rs, i) -> map(rs), args.toArray()
        );
    }

    @Override
    public Optional<IndicatorVO> find(Long id) {
        return jdbc.query("SELECT " + COLS + " FROM de_indicator WHERE id = ?", (rs, i) -> map(rs), id)
                .stream().findFirst();
    }

    @Override
    public Optional<IndicatorVO> findByField(String datasetId, String fieldName) {
        return jdbc.query(
                "SELECT " + COLS + " FROM de_indicator WHERE dataset_id = ? AND field_name = ? LIMIT 1",
                (rs, i) -> map(rs), datasetId, fieldName
        ).stream().findFirst();
    }

    @Override
    public Optional<IndicatorVO> updateStatus(Long id, String status) {
        jdbc.update("UPDATE de_indicator SET status = ?, updated_at = ? WHERE id = ?", status, System.currentTimeMillis(), id);
        return find(id);
    }

    @Override
    public Optional<IndicatorVO> updateConfidence(Long id, double confidence) {
        jdbc.update("UPDATE de_indicator SET confidence = ?, updated_at = ? WHERE id = ?", confidence, System.currentTimeMillis(), id);
        return find(id);
    }

    @Override
    public boolean delete(Long id) {
        return jdbc.update("DELETE FROM de_indicator WHERE id = ?", id) > 0;
    }

    private IndicatorVO map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new IndicatorVO(
                rs.getLong("id"),
                rs.getString("dataset_id"),
                rs.getString("field_name"),
                rs.getString("name"),
                rs.getString("agg"),
                rs.getString("unit"),
                rs.getString("formula"),
                rs.getString("description"),
                rs.getString("status"),
                rs.getString("source"),
                rs.getDouble("confidence"),
                rs.getLong("created_at"),
                rs.getLong("updated_at")
        );
    }
}
