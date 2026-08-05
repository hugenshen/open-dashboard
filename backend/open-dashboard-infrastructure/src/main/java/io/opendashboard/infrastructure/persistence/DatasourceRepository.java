package io.opendashboard.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.DatasourceDtos.DatasourceCreateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceUpdateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceVO;
import io.opendashboard.domain.gateway.DatasourceGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
@Profile("!stub")
public class DatasourceRepository implements DatasourceGateway {

    

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public DatasourceRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<DatasourceVO> list() {
        return jdbc.query(
                """
                SELECT id, name, type, host, port, db_name, schema_name, username, password_enc, status, ext_json, update_time
                FROM de_datasource ORDER BY id
                """,
                (rs, i) -> mapVo(rs)
        );
    }

    public Optional<DatasourceVO> find(String id) {
        return findStored(id).map(DatasourceGateway.StoredDatasource::vo);
    }

    public Optional<DatasourceGateway.StoredDatasource> findStored(String id) {
        List<DatasourceGateway.StoredDatasource> rows = jdbc.query(
                """
                SELECT id, name, type, host, port, db_name, schema_name, username, password_enc, status, ext_json, update_time
                FROM de_datasource WHERE id = ?
                """,
                (rs, i) -> new DatasourceGateway.StoredDatasource(mapVo(rs), rs.getString("password_enc")),
                id
        );
        return rows.stream().findFirst();
    }

    public DatasourceVO create(DatasourceCreateRequest req, String passwordEnc) {
        String id = "src_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        long now = System.currentTimeMillis();
        String type = req.type() == null || req.type().isBlank() ? "mysql" : req.type();
        jdbc.update(
                """
                INSERT INTO de_datasource
                  (id, name, type, host, port, db_name, schema_name, username, password_enc, status, ext_json, create_time, update_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?::jsonb, ?, ?)
                """,
                id,
                blankTo(req.name(), "未命名连接"),
                type,
                req.host(),
                req.port(),
                req.dbName(),
                req.schema(),
                req.username(),
                passwordEnc,
                writeJson(req.ext()),
                now,
                now
        );
        return find(id).orElseThrow();
    }

    public Optional<DatasourceVO> update(String id, DatasourceUpdateRequest req, String passwordEncOrNull) {
        DatasourceVO cur = find(id).orElse(null);
        if (cur == null) return Optional.empty();
        long now = System.currentTimeMillis();
        if (passwordEncOrNull != null) {
            jdbc.update(
                    """
                    UPDATE de_datasource
                    SET name = ?, host = ?, port = ?, db_name = ?, schema_name = ?, username = ?,
                        password_enc = ?, status = ?, ext_json = ?::jsonb, update_time = ?
                    WHERE id = ?
                    """,
                    req.name() == null ? cur.name() : req.name(),
                    req.host() == null ? cur.host() : req.host(),
                    req.port() == null ? cur.port() : req.port(),
                    req.dbName() == null ? cur.dbName() : req.dbName(),
                    req.schema() == null ? cur.schema() : req.schema(),
                    req.username() == null ? cur.username() : req.username(),
                    passwordEncOrNull,
                    req.status() == null ? cur.status() : req.status(),
                    writeJson(req.ext() == null ? cur.ext() : req.ext()),
                    now,
                    id
            );
        } else {
            jdbc.update(
                    """
                    UPDATE de_datasource
                    SET name = ?, host = ?, port = ?, db_name = ?, schema_name = ?, username = ?,
                        status = ?, ext_json = ?::jsonb, update_time = ?
                    WHERE id = ?
                    """,
                    req.name() == null ? cur.name() : req.name(),
                    req.host() == null ? cur.host() : req.host(),
                    req.port() == null ? cur.port() : req.port(),
                    req.dbName() == null ? cur.dbName() : req.dbName(),
                    req.schema() == null ? cur.schema() : req.schema(),
                    req.username() == null ? cur.username() : req.username(),
                    req.status() == null ? cur.status() : req.status(),
                    writeJson(req.ext() == null ? cur.ext() : req.ext()),
                    now,
                    id
            );
        }
        return find(id);
    }

    public void updateStatus(String id, String status) {
        jdbc.update("UPDATE de_datasource SET status = ?, update_time = ? WHERE id = ?",
                status, System.currentTimeMillis(), id);
    }

    public boolean delete(String id) {
        return jdbc.update("DELETE FROM de_datasource WHERE id = ?", id) > 0;
    }

    private DatasourceVO mapVo(java.sql.ResultSet rs) throws java.sql.SQLException {
        String pwd = rs.getString("password_enc");
        return new DatasourceVO(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("type"),
                rs.getString("host"),
                rs.getObject("port") == null ? null : rs.getInt("port"),
                rs.getString("db_name"),
                rs.getString("schema_name"),
                rs.getString("username"),
                pwd != null && !pwd.isBlank(),
                rs.getString("status"),
                readJson(rs.getString("ext_json")),
                rs.getObject("update_time") == null ? null : rs.getLong("update_time")
        );
    }

    private Map<String, Object> readJson(String json) {
        if (json == null || json.isBlank() || "null".equals(json)) return Map.of();
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private String writeJson(Map<String, Object> map) {
        try {
            return mapper.writeValueAsString(map == null ? Map.of() : map);
        } catch (Exception e) {
            return "{}";
        }
    }

    private static String blankTo(String v, String fallback) {
        return v == null || v.isBlank() ? fallback : v.trim();
    }
}
