package io.opendashboard.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.DatasetDtos.FieldProfileVO;
import io.opendashboard.domain.gateway.FieldProfileGateway;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.context.annotation.Profile;

import java.util.ArrayList;
import java.util.List;

/**
 * JDBC storage for field self-learning profiles (de_dataset_field_profile).
 * JSONB columns use the same ObjectMapper conventions as ConversationRepository.
 */
@Repository
@Profile("!stub")
public class FieldProfileRepository implements FieldProfileGateway {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public FieldProfileRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public void save(FieldProfileVO p) {
        jdbc.update(
                """
                INSERT INTO de_dataset_field_profile
                (dataset_id, field_name, field_label, data_type, role_learned, role_source,
                 distinct_count, null_count, null_rate, numeric_min, numeric_max,
                 distinct_values, is_timestamp_like, sample_json, learned_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb, ?)
                ON CONFLICT (dataset_id, field_name) DO UPDATE SET
                  field_label = EXCLUDED.field_label,
                  data_type = EXCLUDED.data_type,
                  role_learned = EXCLUDED.role_learned,
                  role_source = EXCLUDED.role_source,
                  distinct_count = EXCLUDED.distinct_count,
                  null_count = EXCLUDED.null_count,
                  null_rate = EXCLUDED.null_rate,
                  numeric_min = EXCLUDED.numeric_min,
                  numeric_max = EXCLUDED.numeric_max,
                  distinct_values = EXCLUDED.distinct_values,
                  is_timestamp_like = EXCLUDED.is_timestamp_like,
                  sample_json = EXCLUDED.sample_json,
                  learned_at = EXCLUDED.learned_at
                """,
                p.datasetId(), p.fieldName(), p.fieldLabel(), p.dataType(), p.roleLearned(), p.roleSource(),
                p.distinctCount(), p.nullCount(), p.nullRate(), p.numericMin(), p.numericMax(),
                writeJson(p.distinctValues() == null ? List.of() : p.distinctValues()),
                p.timestampLike(),
                writeJson(p.sample() == null ? List.of() : p.sample()),
                p.learnedAt()
        );
    }

    @Override
    public List<FieldProfileVO> listByDataset(String datasetId) {
        return jdbc.query(
                """
                SELECT dataset_id, field_name, field_label, data_type, role_learned, role_source,
                       distinct_count, null_count, null_rate, numeric_min, numeric_max,
                       distinct_values, is_timestamp_like, sample_json, learned_at
                FROM de_dataset_field_profile WHERE dataset_id = ?
                """,
                (rs, i) -> new FieldProfileVO(
                        rs.getString("dataset_id"),
                        rs.getString("field_name"),
                        rs.getString("field_label"),
                        rs.getString("data_type"),
                        rs.getString("role_learned"),
                        rs.getString("role_source"),
                        rs.getLong("distinct_count"),
                        rs.getLong("null_count"),
                        rs.getDouble("null_rate"),
                        rs.getDouble("numeric_min"),
                        rs.getDouble("numeric_max"),
                        readList(rs.getString("distinct_values")),
                        rs.getBoolean("is_timestamp_like"),
                        readRows(rs.getString("sample_json")),
                        rs.getLong("learned_at")
                ),
                datasetId
        );
    }

    @Override
    public void deleteByDataset(String datasetId) {
        jdbc.update("DELETE FROM de_dataset_field_profile WHERE dataset_id = ?", datasetId);
    }

    private List<Object> readList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private List<List<Object>> readRows(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private String writeJson(Object value) {
        try {
            return mapper.writeValueAsString(value == null ? List.of() : value);
        } catch (Exception e) {
            return "[]";
        }
    }
}
