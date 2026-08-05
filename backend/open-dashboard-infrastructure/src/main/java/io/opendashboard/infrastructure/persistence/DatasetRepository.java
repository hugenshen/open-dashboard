package io.opendashboard.infrastructure.persistence;

import io.opendashboard.domain.CatalogDtos.DatasetCatalogItem;
import io.opendashboard.domain.CatalogDtos.DatasetFieldItem;
import io.opendashboard.domain.DatasetDtos.DatasetCreateRequest;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.DatasetDtos.DatasetUpdateRequest;
import io.opendashboard.domain.gateway.DatasetGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
@Profile("!stub")
public class DatasetRepository implements DatasetGateway {

    private final JdbcTemplate jdbc;

    public DatasetRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<DatasetMetaVO> list() {
        return jdbc.query(
                """
                SELECT id, name, folder, datasource_id, table_name, status, update_time
                FROM de_dataset ORDER BY id
                """,
                (rs, i) -> new DatasetMetaVO(
                        rs.getString("id"),
                        rs.getString("name"),
                        rs.getString("folder"),
                        rs.getString("datasource_id"),
                        rs.getString("table_name"),
                        rs.getString("status"),
                        rs.getObject("update_time") == null ? null : rs.getLong("update_time")
                )
        );
    }

    public Optional<DatasetDetailVO> find(String id) {
        List<DatasetMetaVO> metas = jdbc.query(
                """
                SELECT id, name, folder, datasource_id, table_name, status, update_time
                FROM de_dataset WHERE id = ?
                """,
                (rs, i) -> new DatasetMetaVO(
                        rs.getString("id"),
                        rs.getString("name"),
                        rs.getString("folder"),
                        rs.getString("datasource_id"),
                        rs.getString("table_name"),
                        rs.getString("status"),
                        rs.getObject("update_time") == null ? null : rs.getLong("update_time")
                ),
                id
        );
        if (metas.isEmpty()) return Optional.empty();
        List<DatasetFieldVO> fields = jdbc.query(
                """
                SELECT name, label, field_group, data_type, origin, expression
                FROM de_dataset_field WHERE dataset_id = ? ORDER BY ord, id
                """,
                (rs, i) -> new DatasetFieldVO(
                        rs.getString("name"),
                        rs.getString("label"),
                        rs.getString("field_group"),
                        rs.getString("data_type"),
                        rs.getString("origin"),
                        rs.getString("expression")
                ),
                id
        );
        return Optional.of(new DatasetDetailVO(metas.getFirst(), fields));
    }

    public DatasetDetailVO create(DatasetCreateRequest req) {
        String id = req.name() != null && req.name().startsWith("ds_")
                ? "ds_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8)
                : "ds_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                INSERT INTO de_dataset (id, name, folder, datasource_id, table_name, status, create_time, update_time)
                VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)
                """,
                id,
                req.name() == null || req.name().isBlank() ? "未命名数据集" : req.name().trim(),
                req.folder() == null ? "未分组" : req.folder(),
                req.datasourceId(),
                req.tableName(),
                now,
                now
        );
        replaceFields(id, req.fields() == null ? List.of() : req.fields());
        return find(id).orElseThrow();
    }

    public Optional<DatasetDetailVO> update(String id, DatasetUpdateRequest req) {
        DatasetDetailVO cur = find(id).orElse(null);
        if (cur == null) return Optional.empty();
        long now = System.currentTimeMillis();
        jdbc.update(
                """
                UPDATE de_dataset SET name = ?, folder = ?, table_name = ?, status = ?, update_time = ?
                WHERE id = ?
                """,
                req.name() == null ? cur.meta().name() : req.name(),
                req.folder() == null ? cur.meta().folder() : req.folder(),
                req.tableName() == null ? cur.meta().tableName() : req.tableName(),
                req.status() == null ? cur.meta().status() : req.status(),
                now,
                id
        );
        return find(id);
    }

    public Optional<DatasetDetailVO> replaceFields(String id, List<DatasetFieldVO> fields) {
        if (find(id).isEmpty()) return Optional.empty();
        jdbc.update("DELETE FROM de_dataset_field WHERE dataset_id = ?", id);
        long base = System.currentTimeMillis();
        int ord = 0;
        for (DatasetFieldVO f : fields) {
            long fid = base + (++ord);
            String origin = f.origin() == null || f.origin().isBlank() ? "table" : f.origin();
            jdbc.update(
                    """
                    INSERT INTO de_dataset_field
                      (id, dataset_id, name, label, field_group, data_type, ord, origin, expression)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    fid,
                    id,
                    f.name(),
                    f.label() == null ? f.name() : f.label(),
                    f.group() == null ? "dim" : f.group(),
                    f.dataType(),
                    ord,
                    origin,
                    f.expression()
            );
        }
        return find(id);
    }

    public boolean delete(String id) {
        jdbc.update("DELETE FROM de_dataset_field WHERE dataset_id = ?", id);
        return jdbc.update("DELETE FROM de_dataset WHERE id = ?", id) > 0;
    }

    public List<DatasetCatalogItem> listCatalog() {
        List<DatasetCatalogItem> out = new ArrayList<>();
        for (DatasetMetaVO meta : list()) {
            List<DatasetFieldItem> fields = jdbc.query(
                    """
                    SELECT name, label, field_group FROM de_dataset_field
                    WHERE dataset_id = ? ORDER BY ord, id
                    """,
                    (rs, i) -> new DatasetFieldItem(
                            rs.getString("name"),
                            rs.getString("label"),
                            rs.getString("field_group")
                    ),
                    meta.id()
            );
            out.add(new DatasetCatalogItem(meta.id(), meta.name(), fields));
        }
        return out;
    }
}
