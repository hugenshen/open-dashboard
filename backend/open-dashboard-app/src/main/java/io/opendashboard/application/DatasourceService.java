package io.opendashboard.application;

import io.opendashboard.domain.DatasourceDtos.ColumnItem;
import io.opendashboard.domain.DatasourceDtos.DatasourceCreateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceProbeRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceUpdateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceVO;
import io.opendashboard.domain.DatasourceDtos.TableItem;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.datasource.ConnectionSpec;
import io.opendashboard.domain.gateway.DataSourcePort;
import io.opendashboard.domain.gateway.DataSourcePort.PingResult;
import io.opendashboard.domain.gateway.SecretCipher;
import io.opendashboard.domain.gateway.DatasourceGateway;
import io.opendashboard.domain.gateway.DatasourceGateway.StoredDatasource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DatasourceService {

    private record MemRow(DatasourceVO vo, String passwordEnc) {}

    private final ObjectProvider<DatasourceGateway> repository;
    private final DataSourcePort jdbc;
    private final SecretCipher crypto;
    private final ConcurrentHashMap<String, MemRow> mem = new ConcurrentHashMap<>();

    public DatasourceService(
            ObjectProvider<DatasourceGateway> repository,
            DataSourcePort jdbc,
            SecretCipher crypto
    ) {
        this.repository = repository;
        this.jdbc = jdbc;
        this.crypto = crypto;
    }

    public List<DatasourceVO> list() {
        DatasourceGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.list();
        return mem.values().stream().map(MemRow::vo).toList();
    }

    public Optional<DatasourceVO> get(String id) {
        DatasourceGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.find(id);
        return Optional.ofNullable(mem.get(id)).map(MemRow::vo);
    }

    public DatasourceVO create(DatasourceCreateRequest req) {
        String type = req.type() == null ? "mysql" : req.type();
        boolean jdbc = "mysql".equalsIgnoreCase(type) || "pg".equalsIgnoreCase(type)
                || "postgresql".equalsIgnoreCase(type) || "mariadb".equalsIgnoreCase(type);
        if (jdbc && (req.password() == null || req.password().isBlank())) {
            throw new IllegalArgumentException("JDBC 数据源必须填写密码");
        }
        if (jdbc && (req.host() == null || req.host().isBlank() || req.dbName() == null || req.dbName().isBlank())) {
            throw new IllegalArgumentException("JDBC 数据源必须填写 Host 与 Database");
        }
        String enc = req.password() == null || req.password().isBlank() ? null : crypto.encrypt(req.password());
        DatasourceGateway repo = repository.getIfAvailable();
        if (repo != null) {
            DatasourceVO vo = repo.create(req, enc);
            return afterSavePing(vo);
        }
        String id = "src_" + System.currentTimeMillis();
        DatasourceVO vo = new DatasourceVO(
                id,
                blankTo(req.name(), "未命名连接"),
                type,
                req.host(),
                req.port(),
                req.dbName(),
                req.schema(),
                req.username(),
                enc != null,
                "unknown",
                req.ext() == null ? Map.of() : req.ext(),
                System.currentTimeMillis()
        );
        mem.put(id, new MemRow(vo, enc));
        return afterSavePing(vo);
    }

    public Optional<DatasourceVO> update(String id, DatasourceUpdateRequest req) {
        String enc = null;
        boolean touchPassword = req.password() != null && !req.password().isBlank();
        if (touchPassword) enc = crypto.encrypt(req.password());

        DatasourceGateway repo = repository.getIfAvailable();
        if (repo != null) {
            Optional<DatasourceVO> updated = repo.update(id, req, touchPassword ? enc : null);
            return updated.map(this::afterSavePing);
        }
        MemRow cur = mem.get(id);
        if (cur == null) return Optional.empty();
        DatasourceVO next = new DatasourceVO(
                cur.vo().id(),
                req.name() == null ? cur.vo().name() : req.name(),
                cur.vo().type(),
                req.host() == null ? cur.vo().host() : req.host(),
                req.port() == null ? cur.vo().port() : req.port(),
                req.dbName() == null ? cur.vo().dbName() : req.dbName(),
                req.schema() == null ? cur.vo().schema() : req.schema(),
                req.username() == null ? cur.vo().username() : req.username(),
                touchPassword || cur.vo().hasPassword(),
                req.status() == null ? cur.vo().status() : req.status(),
                req.ext() == null ? cur.vo().ext() : req.ext(),
                System.currentTimeMillis()
        );
        mem.put(id, new MemRow(next, touchPassword ? enc : cur.passwordEnc()));
        return Optional.of(afterSavePing(next));
    }

    public boolean delete(String id) {
        DatasourceGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.delete(id);
        return mem.remove(id) != null;
    }

    public PingResult ping(String id) {
        ConnectionSpec spec = resolveSpec(id).orElse(null);
        if (spec == null) return new PingResult(false, "数据源不存在", 0, "NotFound");
        if (!spec.isJdbc()) return new PingResult(false, "该类型暂不支持 JDBC 探测", 0, "Unsupported");
        PingResult r = jdbc.ping(spec);
        setStatus(id, r.ok() ? "ok" : "error");
        return r;
    }

    public Map<String, Object> probe(DatasourceProbeRequest req) {
        ConnectionSpec spec = fromProbe(req);
        if (!spec.isJdbc()) {
            return Map.of("ok", false, "message", "一期仅支持 MySQL / PostgreSQL");
        }
        String action = req.action() == null ? "ping" : req.action().toLowerCase();
        try {
            return switch (action) {
                case "ping" -> {
                    PingResult r = jdbc.ping(spec);
                    yield Map.of("ok", r.ok(), "message", r.message(), "latencyMs", r.latencyMs());
                }
                case "databases" -> Map.of("ok", true, "databases", jdbc.listDatabases(spec));
                case "schemas" -> Map.of("ok", true, "schemas", jdbc.listSchemas(spec));
                case "tables" -> Map.of("ok", true, "tables", jdbc.listTables(spec));
                case "columns" -> {
                    if (req.table() == null || req.table().isBlank()) {
                        yield Map.of("ok", false, "message", "缺少 table");
                    }
                    yield Map.of("ok", true, "columns", jdbc.listColumns(spec, req.table()));
                }
                default -> Map.of("ok", false, "message", "未知 action: " + action);
            };
        } catch (Exception e) {
            return Map.of("ok", false, "message", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
    }

    public List<String> databases(String id) {
        return jdbc.listDatabases(requireJdbcSpec(id));
    }

    public List<String> schemas(String id) {
        return jdbc.listSchemas(requireJdbcSpec(id));
    }

    public List<TableItem> tables(String id, String schemaOverride) {
        ConnectionSpec spec = requireJdbcSpec(id);
        if (schemaOverride != null && !schemaOverride.isBlank()) {
            spec = spec.withSchema(schemaOverride);
        }
        return jdbc.listTables(spec);
    }

    public List<ColumnItem> columns(String id, String table, String schemaOverride) {
        ConnectionSpec spec = requireJdbcSpec(id);
        if (schemaOverride != null && !schemaOverride.isBlank()) {
            spec = spec.withSchema(schemaOverride);
        }
        return jdbc.listColumns(spec, table);
    }

    public DatasetQueryResult preview(String id, String table, String schemaOverride, int limit) {
        ConnectionSpec spec = requireJdbcSpec(id);
        if (schemaOverride != null && !schemaOverride.isBlank()) {
            spec = spec.withSchema(schemaOverride);
        }
        return jdbc.previewTable(spec, table, limit);
    }

    public Optional<ConnectionSpec> resolveSpec(String id) {
        DatasourceGateway repo = repository.getIfAvailable();
        if (repo != null) {
            Optional<StoredDatasource> stored = repo.findStored(id);
            if (stored.isEmpty()) return Optional.empty();
            StoredDatasource s = stored.get();
            String pwd = s.passwordEnc() == null ? "" : crypto.decrypt(s.passwordEnc());
            DatasourceVO vo = s.vo();
            return Optional.of(new ConnectionSpec(
                    vo.type(), vo.host(), vo.port(), vo.dbName(), vo.schema(), vo.username(), pwd
            ));
        }
        MemRow row = mem.get(id);
        if (row == null) return Optional.empty();
        String pwd = row.passwordEnc() == null ? "" : crypto.decrypt(row.passwordEnc());
        DatasourceVO vo = row.vo();
        return Optional.of(new ConnectionSpec(
                vo.type(), vo.host(), vo.port(), vo.dbName(), vo.schema(), vo.username(), pwd
        ));
    }

    private ConnectionSpec requireJdbcSpec(String id) {
        ConnectionSpec spec = resolveSpec(id).orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        if (!spec.isJdbc()) throw new IllegalArgumentException("该类型暂不支持探库");
        return spec;
    }

    private ConnectionSpec fromProbe(DatasourceProbeRequest req) {
        return new ConnectionSpec(
                req.type(),
                req.host(),
                req.port(),
                req.dbName(),
                req.schema(),
                req.username(),
                req.password() == null ? "" : req.password()
        );
    }

    private DatasourceVO afterSavePing(DatasourceVO vo) {
        try {
            ConnectionSpec spec = resolveSpec(vo.id()).orElse(null);
            if (spec != null && spec.isJdbc() && spec.host() != null) {
                PingResult r = jdbc.ping(spec);
                setStatus(vo.id(), r.ok() ? "ok" : "error");
                return get(vo.id()).orElse(vo);
            }
        } catch (Exception ignored) {
            setStatus(vo.id(), "error");
        }
        return get(vo.id()).orElse(vo);
    }

    private void setStatus(String id, String status) {
        DatasourceGateway repo = repository.getIfAvailable();
        if (repo != null) {
            repo.updateStatus(id, status);
            return;
        }
        MemRow cur = mem.get(id);
        if (cur == null) return;
        DatasourceVO v = cur.vo();
        mem.put(id, new MemRow(new DatasourceVO(
                v.id(), v.name(), v.type(), v.host(), v.port(), v.dbName(), v.schema(),
                v.username(), v.hasPassword(), status, v.ext(), System.currentTimeMillis()
        ), cur.passwordEnc()));
    }

    private static String blankTo(String v, String fallback) {
        return v == null || v.isBlank() ? fallback : v.trim();
    }
}
