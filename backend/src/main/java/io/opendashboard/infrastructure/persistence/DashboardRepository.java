package io.opendashboard.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutVO;
import io.opendashboard.domain.DashboardDtos.DashboardNodeVO;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
@Profile("!stub")
public class DashboardRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public DashboardRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Optional<DashboardDetailVO> findDetail(long id) {
        List<DashboardNodeVO> metas = jdbc.query(
                """
                SELECT id, pid, name, node_type, status, layout_mode, content_id, version, update_time
                FROM de_dashboard WHERE id = ?
                """,
                (rs, rowNum) -> new DashboardNodeVO(
                        String.valueOf(rs.getLong("id")),
                        String.valueOf(rs.getLong("pid")),
                        rs.getString("name"),
                        rs.getString("node_type"),
                        rs.getString("status"),
                        rs.getString("layout_mode"),
                        String.valueOf(rs.getLong("content_id")),
                        rs.getInt("version"),
                        rs.getObject("update_time") == null ? null : rs.getLong("update_time")
                ),
                id
        );
        if (metas.isEmpty()) {
            return Optional.empty();
        }
        DashboardLayoutVO layout = jdbc.query(
                """
                SELECT grid_cols, grid_rows, theme_ref, refresh_sec, ext_style, mobile_json
                FROM de_dashboard_layout
                WHERE dashboard_id = ? AND copy_type = 'draft'
                """,
                rs -> {
                    if (!rs.next()) {
                        return new DashboardLayoutVO(72, 36, null, 0, Map.of(), Map.of());
                    }
                    return new DashboardLayoutVO(
                            rs.getInt("grid_cols"),
                            rs.getInt("grid_rows"),
                            rs.getString("theme_ref"),
                            rs.getObject("refresh_sec") == null ? null : rs.getInt("refresh_sec"),
                            readJsonMap(rs.getString("ext_style")),
                            readJsonMap(rs.getString("mobile_json"))
                    );
                },
                id
        );
        return Optional.of(new DashboardDetailVO(
                metas.getFirst(),
                layout,
                List.of(),
                Map.of(),
                List.of()
        ));
    }

    private Map<String, Object> readJsonMap(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }
}
