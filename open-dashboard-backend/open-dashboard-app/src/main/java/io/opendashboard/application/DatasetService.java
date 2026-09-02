package io.opendashboard.application;

import io.opendashboard.domain.CatalogDtos.DatasetCatalogItem;
import io.opendashboard.domain.CatalogDtos.DatasetFieldItem;
import io.opendashboard.domain.DatasetDtos.DatasetCreateRequest;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.DatasetDtos.DatasetUpdateRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import io.opendashboard.domain.gateway.DatasetGateway;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DatasetService {

    private final ObjectProvider<DatasetGateway> repository;
    private final ObjectProvider<DatasourceService> datasourceService;
    private final StubQueryService stubQueryService;
    private final FileTableStore fileTables;
    private final ObjectProvider<io.opendashboard.application.conversation.DatasetProfileLearner> learner;
    private final ObjectProvider<io.opendashboard.application.conversation.FieldLearnReviewer> fieldReviewer;
    private final ObjectProvider<DatasetPermissionService> permissions;
    private final ObjectProvider<EffectiveAccessService> access;
    private final ConcurrentHashMap<String, DatasetDetailVO> mem = new ConcurrentHashMap<>();
    private final java.util.concurrent.ExecutorService learnExecutor =
            java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "dataset-learn");
                t.setDaemon(true);
                return t;
            });

    public DatasetService(
            ObjectProvider<DatasetGateway> repository,
            ObjectProvider<DatasourceService> datasourceService,
            StubQueryService stubQueryService,
            FileTableStore fileTables,
            ObjectProvider<io.opendashboard.application.conversation.DatasetProfileLearner> learner,
            ObjectProvider<io.opendashboard.application.conversation.FieldLearnReviewer> fieldReviewer,
            ObjectProvider<DatasetPermissionService> permissions,
            ObjectProvider<EffectiveAccessService> access
    ) {
        this.repository = repository;
        this.datasourceService = datasourceService;
        this.stubQueryService = stubQueryService;
        this.fileTables = fileTables;
        this.learner = learner;
        this.fieldReviewer = fieldReviewer;
        this.permissions = permissions;
        this.access = access;
        seedTemplateDemoDatasets();
    }

    /** In-memory fallback when JDBC repo is absent (stub profile). */
    private void seedTemplateDemoDatasets() {
        if (repository.getIfAvailable() != null) return;
        putSeed("ds_sales", "销售明细", "销售分析", "fact_sales", List.of(
                field("region", "区域", "dim"),
                field("channel", "渠道", "dim"),
                field("product", "产品", "dim"),
                field("salesman", "销售员", "dim"),
                field("amount", "销售额", "quota"),
                field("qty", "销量", "quota"),
                field("profit", "利润", "quota"),
                field("order_cnt", "订单数", "quota")
        ));
        putSeed("ds_ops", "运营日报", "运营增长", "ops_daily", List.of(
                field("day", "日期", "dim"),
                field("module", "模块", "dim"),
                field("platform", "端", "dim"),
                field("channel", "来源", "dim"),
                field("uv", "UV", "quota"),
                field("pv", "PV", "quota"),
                field("bounce", "跳出率", "quota"),
                field("duration", "停留秒", "quota")
        ));
        putSeed("ds_fin", "财务科目月报", "财务库存", "fact_finance", List.of(
                field("month", "月份", "dim"),
                field("subject", "科目", "dim"),
                field("dept", "部门", "dim"),
                field("income", "收入", "quota"),
                field("expense", "支出", "quota"),
                field("profit", "利润", "quota")
        ));
        putSeed("ds_012eb19e", "支付订单表", "订单经营", "t_pay_order", List.of(
                field("PayOrderId", "支付订单ID", "dim"),
                field("CreatedDate", "下单日期", "dim"),
                field("Status", "支付状态（-1=未知/缺失；2=支付成功；3=业务处理完成）", "dim"),
                field("ChannelId", "渠道ID", "dim"),
                field("ProductId", "产品ID", "dim"),
                field("MchId", "商户ID", "dim"),
                field("Amount", "订单金额（单位分）", "quota"),
                field("MchIncome", "商户入账金额（单位分）", "quota"),
                field("AgentProfit", "平台代理利润（单位分）", "quota"),
                field("MchRate", "商户费率", "quota")
        ));
    }

    private void putSeed(String id, String name, String folder, String table, List<DatasetFieldVO> fields) {
        mem.put(id, new DatasetDetailVO(
                new DatasetMetaVO(id, name, folder, "src_demo", table, "ready", 0L),
                fields
        ));
    }

    private static DatasetFieldVO field(String name, String label, String group) {
        return new DatasetFieldVO(name, label, group, "dim".equals(group) ? "STRING" : "DECIMAL");
    }

    public List<DatasetMetaVO> list() {
        return visibleDatasets(listCatalog());
    }

    /** All published datasets, without ACL filter. Data plaza uses this to show requestable rows. */
    public List<DatasetMetaVO> listCatalog() {
        DatasetGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.list();
        return mem.values().stream().map(DatasetDetailVO::meta).toList();
    }

    private List<DatasetMetaVO> visibleDatasets(List<DatasetMetaVO> all) {
        AuthPrincipal principal = AuthContext.get();
        EffectiveAccessService acl = access.getIfAvailable();
        if (acl == null) return all;
        if (principal == null) return List.of();
        if (EffectiveAccessService.isDataAdmin(principal)) return all;
        java.util.Set<String> allowed = acl.grantedDatasetIds(principal);
        return all.stream().filter(d -> allowed.contains(d.id())).toList();
    }

    public Optional<DatasetDetailVO> get(String id) {
        DatasetGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.find(id);
        return Optional.ofNullable(mem.get(id));
    }

    public DatasetDetailVO create(DatasetCreateRequest req) {
        DatasetGateway repo = repository.getIfAvailable();
        DatasetDetailVO detail;
        if (repo != null) {
            detail = repo.create(req);
        } else {
            String id = "ds_" + System.currentTimeMillis();
            detail = new DatasetDetailVO(
                    new DatasetMetaVO(
                            id,
                            req.name() == null || req.name().isBlank() ? "未命名数据集" : req.name(),
                            req.folder() == null ? "未分组" : req.folder(),
                            req.datasourceId(),
                            req.tableName(),
                            "ready",
                            System.currentTimeMillis()
                    ),
                    req.fields() == null ? List.of() : req.fields()
            );
            mem.put(id, detail);
        }
        DatasetPermissionService acl = permissions.getIfAvailable();
        if (acl != null) {
            acl.grantOwner("dataset", detail.meta().id(), AuthContext.get());
        }
        triggerLearn(detail.meta().id());
        return detail;
    }

    /** 数据集录入后异步触发自学习（不阻塞录入返回；采样失败只记日志不阻断）。 */
    private void triggerLearn(String datasetId) {
        io.opendashboard.application.conversation.DatasetProfileLearner l = learner.getIfAvailable();
        if (l == null) return;
        AuthPrincipal principal = AuthContext.get();
        learnExecutor.submit(() -> {
            l.learn(datasetId);
            io.opendashboard.application.conversation.FieldLearnReviewer r = fieldReviewer.getIfAvailable();
            if (r != null) {
                try {
                    r.apply(datasetId, principal);
                } catch (Exception ignored) {
                    // LLM 复核失败不影响录入
                }
            }
        });
    }

    public DatasetDetailVO importFile(String filename, byte[] bytes) {
        TabularFileParser.ParsedTable parsed = TabularFileParser.parse(filename, bytes);
        String base = filename == null ? "上传数据" : filename.replaceAll("\\.[^.]+$", "");
        if (base.isBlank()) base = "上传数据";
        String table = "od_file_" + Long.toHexString(System.nanoTime());
        DatasetDetailVO detail = create(new DatasetCreateRequest(
                base,
                "问数上传",
                null,
                table,
                parsed.fields()
        ));
        fileTables.put(detail.meta().id(), table, parsed);
        return detail;
    }

    public Optional<DatasetDetailVO> update(String id, DatasetUpdateRequest req) {
        DatasetGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.update(id, req);
        DatasetDetailVO cur = mem.get(id);
        if (cur == null) return Optional.empty();
        DatasetDetailVO next = new DatasetDetailVO(
                new DatasetMetaVO(
                        cur.meta().id(),
                        req.name() == null ? cur.meta().name() : req.name(),
                        req.folder() == null ? cur.meta().folder() : req.folder(),
                        cur.meta().datasourceId(),
                        req.tableName() == null ? cur.meta().tableName() : req.tableName(),
                        req.status() == null ? cur.meta().status() : req.status(),
                        System.currentTimeMillis()
                ),
                cur.fields()
        );
        mem.put(id, next);
        return Optional.of(next);
    }

    public Optional<DatasetDetailVO> putFields(String id, List<DatasetFieldVO> fields) {
        DatasetGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.replaceFields(id, fields == null ? List.of() : fields);
        DatasetDetailVO cur = mem.get(id);
        if (cur == null) return Optional.empty();
        DatasetDetailVO next = new DatasetDetailVO(cur.meta(), fields == null ? List.of() : fields);
        mem.put(id, next);
        return Optional.of(next);
    }

    public boolean delete(String id) {
        fileTables.remove(id);
        DatasetGateway repo = repository.getIfAvailable();
        if (repo != null) return repo.delete(id);
        return mem.remove(id) != null;
    }

    public Optional<DatasetQueryResult> preview(String id) {
        DatasetDetailVO detail = get(id).orElse(null);
        if (detail == null) return Optional.empty();
        if (fileTables.has(id)) {
            return Optional.ofNullable(fileTables.scan(id, 10));
        }
        try {
            String srcId = detail.meta().datasourceId();
            String table = detail.meta().tableName();
            DatasourceService src = datasourceService.getIfAvailable();
            if (src != null && srcId != null && table != null && !table.isBlank()) {
                return Optional.of(src.preview(srcId, table, null, 10));
            }
        } catch (Exception ignored) {
            // fall through to query layer / stub
        }
        return Optional.of(stubQueryService.execute(new DatasetQueryRequest(
                id,
                null,
                null,
                null,
                null,
                10,
                Map.of("includeSql", true)
        )));
    }

    public List<DatasetCatalogItem> catalog() {
        DatasetGateway repo = repository.getIfAvailable();
        List<DatasetCatalogItem> all;
        if (repo != null) {
            all = repo.listCatalog();
        } else {
            all = new ArrayList<>();
            for (DatasetDetailVO d : mem.values()) {
                all.add(new DatasetCatalogItem(
                        d.meta().id(),
                        d.meta().name(),
                        d.fields().stream()
                                .map(f -> new DatasetFieldItem(f.name(), f.label(), f.group()))
                                .toList()
                ));
            }
        }
        AuthPrincipal principal = AuthContext.get();
        EffectiveAccessService acl = access.getIfAvailable();
        if (acl == null) return all;
        if (principal == null) return List.of();
        if (EffectiveAccessService.isDataAdmin(principal)) return all;
        java.util.Set<String> allowed = acl.grantedDatasetIds(principal);
        return all.stream().filter(d -> allowed.contains(d.id())).toList();
    }
}
