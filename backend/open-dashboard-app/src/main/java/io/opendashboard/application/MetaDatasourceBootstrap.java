package io.opendashboard.application;

import io.opendashboard.domain.DatasetDtos.DatasetCreateRequest;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.DatasourceDtos.ColumnItem;
import io.opendashboard.domain.DatasourceDtos.DatasourceCreateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceVO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * First-run bootstrap: register the meta PostgreSQL as a real JDBC datasource
 * (and a sample dataset) so a fresh Docker deploy is usable without manual setup.
 */
@Component
public class MetaDatasourceBootstrap {

    private static final Logger log = LoggerFactory.getLogger(MetaDatasourceBootstrap.class);
    private static final String SAMPLE_TABLE = "de_datasource";

    private final DatasourceService datasourceService;
    private final DatasetService datasetService;
    private final boolean enabled;
    private final String host;
    private final int port;
    private final String dbName;
    private final String schema;
    private final String username;
    private final String password;
    private final String datasourceName;
    private final boolean createSampleDataset;

    public MetaDatasourceBootstrap(
            DatasourceService datasourceService,
            DatasetService datasetService,
            @Value("${opendashboard.bootstrap.meta-datasource:false}") boolean enabled,
            @Value("${opendashboard.bootstrap.host:postgres}") String host,
            @Value("${opendashboard.bootstrap.port:5432}") int port,
            @Value("${opendashboard.bootstrap.db-name:opendashboard}") String dbName,
            @Value("${opendashboard.bootstrap.schema:public}") String schema,
            @Value("${opendashboard.bootstrap.username:${spring.datasource.username:opendashboard}}") String username,
            @Value("${opendashboard.bootstrap.password:${spring.datasource.password:opendashboard}}") String password,
            @Value("${opendashboard.bootstrap.datasource-name:元数据库}") String datasourceName,
            @Value("${opendashboard.bootstrap.sample-dataset:true}") boolean createSampleDataset
    ) {
        this.datasourceService = datasourceService;
        this.datasetService = datasetService;
        this.enabled = enabled;
        this.host = host;
        this.port = port;
        this.dbName = dbName;
        this.schema = schema;
        this.username = username;
        this.password = password;
        this.datasourceName = datasourceName;
        this.createSampleDataset = createSampleDataset;
    }

    @Order(100)
    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        if (!enabled) return;
        try {
            List<DatasourceVO> existing = datasourceService.list();
            DatasourceVO ds;
            if (existing.isEmpty()) {
                ds = datasourceService.create(new DatasourceCreateRequest(
                        datasourceName,
                        "pg",
                        host,
                        port,
                        dbName,
                        schema,
                        username,
                        password,
                        Map.of("bootstrap", true)
                ));
                log.info("Bootstrap datasource created: id={} name={} host={}:{}",
                        ds.id(), ds.name(), host, port);
            } else {
                ds = existing.get(0);
                log.info("Bootstrap skipped datasource create ({} already present)", existing.size());
            }

            if (!createSampleDataset) return;
            if (!datasetService.list().isEmpty()) {
                log.info("Bootstrap skipped sample dataset (datasets already present)");
                return;
            }

            List<DatasetFieldVO> fields = fieldsFromTable(ds.id());
            if (fields.isEmpty()) {
                fields = List.of(
                        new DatasetFieldVO("id", "ID", "d", "STRING"),
                        new DatasetFieldVO("name", "名称", "d", "STRING"),
                        new DatasetFieldVO("type", "类型", "d", "STRING"),
                        new DatasetFieldVO("status", "状态", "d", "STRING")
                );
            }
            datasetService.create(new DatasetCreateRequest(
                    "数据源清单",
                    "默认",
                    ds.id(),
                    SAMPLE_TABLE,
                    fields
            ));
            log.info("Bootstrap sample dataset created on table {}", SAMPLE_TABLE);
        } catch (Exception e) {
            log.warn("Bootstrap meta datasource failed: {}", e.getMessage());
        }
    }

    private List<DatasetFieldVO> fieldsFromTable(String datasourceId) {
        try {
            List<ColumnItem> cols = datasourceService.columns(datasourceId, SAMPLE_TABLE, schema);
            List<DatasetFieldVO> out = new ArrayList<>();
            for (ColumnItem c : cols) {
                String group = isNumeric(c.dataType()) ? "q" : "d";
                out.add(new DatasetFieldVO(c.name(), blankTo(c.comment(), c.name()), group, mapType(c.dataType())));
            }
            return out;
        } catch (Exception e) {
            log.debug("Could not introspect {}: {}", SAMPLE_TABLE, e.getMessage());
            return List.of();
        }
    }

    private static boolean isNumeric(String t) {
        if (t == null) return false;
        String s = t.toLowerCase();
        return s.contains("int") || s.contains("num") || s.contains("dec") || s.contains("float")
                || s.contains("double") || s.contains("real") || s.contains("serial");
    }

    private static String mapType(String t) {
        if (t == null) return "STRING";
        String s = t.toLowerCase();
        if (s.contains("bool")) return "BOOLEAN";
        if (s.contains("date") || s.contains("time")) return "TIME";
        if (isNumeric(t)) return "INT";
        return "STRING";
    }

    private static String blankTo(String v, String fallback) {
        return v == null || v.isBlank() ? fallback : v.trim();
    }
}
