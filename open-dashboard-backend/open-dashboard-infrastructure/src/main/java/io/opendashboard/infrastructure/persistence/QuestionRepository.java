package io.opendashboard.infrastructure.persistence;

import io.opendashboard.domain.DatasetDtos.DatasetQuestionVO;
import io.opendashboard.domain.DatasetDtos.QuestionUpsertRequest;
import io.opendashboard.domain.gateway.QuestionGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * JDBC storage for high-frequency questions (de_dataset_question).
 * Same conventions as IndicatorRepository / GlossaryRepository.
 */
@Repository
@Profile("!stub")
public class QuestionRepository implements QuestionGateway {

    private static final String COLS =
            "id, dataset_id, question, sql, chart_type, brief, status, hit_count, created_at, updated_at";

    private final JdbcTemplate jdbc;

    public QuestionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public DatasetQuestionVO upsert(QuestionUpsertRequest req) {
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                INSERT INTO de_dataset_question
                (dataset_id, question, sql, chart_type, brief, status, hit_count, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                req.datasetId(), req.question(), req.sql(), req.chartType(), req.brief(),
                req.status() == null || req.status().isBlank() ? "active" : req.status(),
                now, now
        );
        return listByDataset(req.datasetId(), null).stream()
                .reduce((a, b) -> b).orElse(null);
    }

    @Override
    public Optional<DatasetQuestionVO> update(Long id, QuestionUpsertRequest req) {
        jdbc.update(
                """
                UPDATE de_dataset_question
                SET question = ?, sql = ?, chart_type = ?, brief = ?, status = ?, updated_at = ?
                WHERE id = ?
                """,
                req.question(), req.sql(), req.chartType(), req.brief(),
                req.status() == null || req.status().isBlank() ? "active" : req.status(),
                System.currentTimeMillis(), id
        );
        return find(id);
    }

    @Override
    public List<DatasetQuestionVO> listByDataset(String datasetId, String status) {
        StringBuilder sql = new StringBuilder(
                "SELECT " + COLS + " FROM de_dataset_question WHERE dataset_id = ?");
        List<Object> args = new java.util.ArrayList<>();
        args.add(datasetId);
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            args.add(status);
        }
        sql.append(" ORDER BY created_at DESC, id DESC");
        return jdbc.query(sql.toString(), (rs, i) -> map(rs), args.toArray());
    }

    @Override
    public List<DatasetQuestionVO> listActive(String datasetId, int limit) {
        return jdbc.query(
                "SELECT " + COLS + " FROM de_dataset_question WHERE dataset_id = ? AND status = 'active' "
                        + "ORDER BY hit_count DESC, updated_at DESC LIMIT " + Math.max(1, limit),
                (rs, i) -> map(rs), datasetId
        );
    }

    @Override
    public Optional<DatasetQuestionVO> find(Long id) {
        return jdbc.query("SELECT " + COLS + " FROM de_dataset_question WHERE id = ?", (rs, i) -> map(rs), id)
                .stream().findFirst();
    }

    @Override
    public Optional<DatasetQuestionVO> updateStatus(Long id, String status) {
        jdbc.update("UPDATE de_dataset_question SET status = ?, updated_at = ? WHERE id = ?",
                status, System.currentTimeMillis(), id);
        return find(id);
    }

    @Override
    public Optional<DatasetQuestionVO> bumpHit(Long id) {
        jdbc.update("UPDATE de_dataset_question SET hit_count = hit_count + 1, updated_at = ? WHERE id = ?",
                System.currentTimeMillis(), id);
        return find(id);
    }

    @Override
    public boolean delete(Long id) {
        return jdbc.update("DELETE FROM de_dataset_question WHERE id = ?", id) > 0;
    }

    private DatasetQuestionVO map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new DatasetQuestionVO(
                rs.getLong("id"),
                rs.getString("dataset_id"),
                rs.getString("question"),
                rs.getString("sql"),
                rs.getString("chart_type"),
                rs.getString("brief"),
                rs.getString("status"),
                rs.getInt("hit_count"),
                rs.getLong("created_at"),
                rs.getLong("updated_at")
        );
    }
}
