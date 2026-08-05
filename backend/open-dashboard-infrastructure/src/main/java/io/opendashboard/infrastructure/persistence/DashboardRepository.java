package io.opendashboard.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.CatalogDtos.DashboardCatalogItem;
import io.opendashboard.domain.CatalogDtos.DashboardChartCatalogItem;
import io.opendashboard.domain.DashboardDtos.BusiNodeVO;
import io.opendashboard.domain.DashboardDtos.ChartViewSaveRequest;
import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardBarVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentsUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardCreateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutVO;
import io.opendashboard.domain.DashboardDtos.DashboardLinkageVO;
import io.opendashboard.domain.DashboardDtos.DashboardMoveRequest;
import io.opendashboard.domain.DashboardDtos.DashboardNodeVO;
import io.opendashboard.domain.DashboardDtos.DashboardRenameRequest;
import io.opendashboard.domain.DashboardDtos.DashboardShareVO;
import io.opendashboard.domain.DashboardDtos.DashboardStatusVO;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.gateway.DashboardGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
@Profile("!stub")
public class DashboardRepository implements DashboardGateway {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public DashboardRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Optional<DashboardDetailVO> findDetail(long id) {
        return findDetail(id, "draft");
    }

    public Optional<DashboardDetailVO> findDetail(long id, String copyType) {
        Optional<DashboardNodeVO> metaOpt = findNode(id);
        if (metaOpt.isEmpty()) return Optional.empty();
        DashboardNodeVO meta = metaOpt.get();
        if ("published".equals(copyType) && "draft".equals(meta.status())) {
            return Optional.empty();
        }
        String copy = "published".equals(copyType) ? "published" : "draft";
        DashboardLayoutVO layout = loadLayout(id, copy);
        List<DashboardComponentVO> components = loadComponents(id, copy);
        Map<String, ChartViewVO> charts = loadCharts(id, copy);
        List<DashboardLinkageVO> linkages = loadLinkages(id, copy);
        return Optional.of(new DashboardDetailVO(meta, layout, components, charts, linkages));
    }

    public List<BusiNodeVO> tree() {
        List<DashboardNodeVO> all = jdbc.query(
                """
                SELECT id, pid, name, node_type, status, layout_mode, content_id, version, update_time
                FROM de_dashboard ORDER BY id
                """,
                (rs, i) -> mapNode(rs)
        );
        return buildTree(all, "0");
    }

    @Transactional
    public DashboardNodeVO create(DashboardCreateRequest req) {
        long id = nextId("de_dashboard");
        long now = System.currentTimeMillis();
        String nodeType = req.nodeType() == null ? "dashboard" : req.nodeType();
        String layoutMode = req.layoutMode() == null ? "grid" : req.layoutMode();
        long pid = parseLong(req.pid(), 0L);
        String actor = AuthContext.userIdOr("system");
        jdbc.update(
                """
                INSERT INTO de_dashboard
                (id, pid, name, node_type, status, layout_mode, content_id, version,
                 create_by, create_time, update_by, update_time)
                VALUES (?, ?, ?, ?, 'draft', ?, 1, 1, ?, ?, ?, ?)
                """,
                id, pid, blankTo(req.name(), "未命名仪表盘"), nodeType, layoutMode,
                actor, now, actor, now
        );
        if ("dashboard".equals(nodeType)) {
            ensureDraftBuckets(id);
        }
        return findNode(id).orElseThrow();
    }

    public Optional<DashboardNodeVO> rename(DashboardRenameRequest req) {
        long id = Long.parseLong(req.id());
        if (findNode(id).isEmpty()) return Optional.empty();
        jdbc.update(
                "UPDATE de_dashboard SET name = ?, update_by = ?, update_time = ? WHERE id = ?",
                blankTo(req.name(), "未命名"), AuthContext.userIdOr("system"), System.currentTimeMillis(), id
        );
        return findNode(id);
    }

    public Optional<DashboardNodeVO> move(DashboardMoveRequest req) {
        long id = Long.parseLong(req.id());
        if (findNode(id).isEmpty()) return Optional.empty();
        long pid = parseLong(req.pid(), 0L);
        jdbc.update(
                "UPDATE de_dashboard SET pid = ?, update_by = ?, update_time = ? WHERE id = ?",
                pid, AuthContext.userIdOr("system"), System.currentTimeMillis(), id
        );
        return findNode(id);
    }

    @Transactional
    public boolean delete(long id) {
        if (findNode(id).isEmpty()) return false;
        jdbc.update("DELETE FROM de_dashboard_component WHERE dashboard_id = ?", id);
        jdbc.update("DELETE FROM de_chart_view WHERE dashboard_id = ?", id);
        jdbc.update("DELETE FROM de_dashboard_linkage WHERE dashboard_id = ?", id);
        jdbc.update("DELETE FROM de_dashboard_layout WHERE dashboard_id = ?", id);
        jdbc.update("DELETE FROM de_dashboard_share WHERE dashboard_id = ?", id);
        jdbc.update("DELETE FROM de_dashboard_auth WHERE dashboard_id = ?", id);
        jdbc.update("DELETE FROM de_dashboard WHERE id = ?", id);
        return true;
    }

    public Optional<DashboardBarVO> barInfo(long id) {
        List<DashboardBarVO> rows = jdbc.query(
                """
                SELECT d.id, d.name, d.node_type, d.status,
                       d.create_by, d.create_time, d.update_by, d.update_time,
                       (SELECT COUNT(*) FROM de_chart_view c
                        WHERE c.dashboard_id = d.id AND c.copy_type = 'draft') AS chart_count
                FROM de_dashboard d WHERE d.id = ?
                """,
                (rs, i) -> new DashboardBarVO(
                        String.valueOf(rs.getLong("id")),
                        rs.getString("name"),
                        rs.getString("node_type"),
                        rs.getString("status"),
                        rs.getString("create_by"),
                        rs.getObject("create_time") == null ? null : rs.getLong("create_time"),
                        rs.getString("update_by"),
                        rs.getObject("update_time") == null ? null : rs.getLong("update_time"),
                        rs.getInt("chart_count")
                ),
                id
        );
        return rows.stream().findFirst();
    }

    public Optional<DashboardLayoutVO> updateLayout(long id, DashboardLayoutUpdateRequest req) {
        if (findNode(id).isEmpty()) return Optional.empty();
        ensureDraftBuckets(id);
        DashboardLayoutVO cur = loadLayout(id, "draft");
        int cols = req.gridCols() == null ? cur.gridCols() : req.gridCols();
        int rows = req.gridRows() == null ? cur.gridRows() : req.gridRows();
        String theme = req.themeRef() == null ? cur.themeRef() : req.themeRef();
        Integer refresh = req.refreshSec() == null ? cur.refreshSec() : req.refreshSec();
        Map<String, Object> ext = req.extStyle() == null ? cur.extStyle() : req.extStyle();
        Map<String, Object> mobile = req.mobile() == null ? cur.mobile() : req.mobile();
        jdbc.update(
                """
                UPDATE de_dashboard_layout
                SET grid_cols = ?, grid_rows = ?, theme_ref = ?, refresh_sec = ?, ext_style = ?::jsonb, mobile_json = ?::jsonb
                WHERE dashboard_id = ? AND copy_type = 'draft'
                """,
                cols, rows, theme, refresh, writeJson(ext), writeJson(mobile), id
        );
        bumpContent(id);
        return Optional.of(loadLayout(id, "draft"));
    }

    public List<DashboardLinkageVO> loadLinkages(long id, String copy) {
        return jdbc.query(
                """
                SELECT id, source_chart_id, source_field, target_chart_id, target_field, enabled
                FROM de_dashboard_linkage
                WHERE dashboard_id = ? AND copy_type = ?
                ORDER BY id
                """,
                (rs, i) -> new DashboardLinkageVO(
                        String.valueOf(rs.getLong("id")),
                        String.valueOf(rs.getLong("source_chart_id")),
                        rs.getString("source_field"),
                        String.valueOf(rs.getLong("target_chart_id")),
                        rs.getString("target_field"),
                        rs.getShort("enabled") != 0
                ),
                id, copy
        );
    }

    @Transactional
    public Optional<List<DashboardLinkageVO>> putLinkages(long id, List<DashboardLinkageVO> linkages) {
        if (findNode(id).isEmpty()) return Optional.empty();
        jdbc.update("DELETE FROM de_dashboard_linkage WHERE dashboard_id = ? AND copy_type = 'draft'", id);
        if (linkages != null) {
            for (DashboardLinkageVO l : linkages) {
                long lid = l.id() == null || l.id().isBlank() ? nextId("de_dashboard_linkage") : parseId(l.id());
                jdbc.update(
                        """
                        INSERT INTO de_dashboard_linkage
                        (id, dashboard_id, copy_type, source_chart_id, source_field, target_chart_id, target_field, enabled)
                        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)
                        """,
                        lid, id, parseId(l.sourceChartId()), l.sourceField(),
                        parseId(l.targetChartId()), l.targetField(),
                        l.enabled() ? 1 : 0
                );
            }
        }
        bumpContent(id);
        return Optional.of(loadLinkages(id, "draft"));
    }

    @Transactional
    public Optional<DashboardStatusVO> discardDraft(long id) {
        Optional<DashboardNodeVO> metaOpt = findNode(id);
        if (metaOpt.isEmpty()) return Optional.empty();
        Integer pub = jdbc.queryForObject(
                "SELECT COUNT(*) FROM de_dashboard_layout WHERE dashboard_id = ? AND copy_type = 'published'",
                Integer.class, id
        );
        if (pub == null || pub == 0) {
            return status(id);
        }
        jdbc.update("DELETE FROM de_dashboard_layout WHERE dashboard_id = ? AND copy_type = 'draft'", id);
        jdbc.update("DELETE FROM de_dashboard_component WHERE dashboard_id = ? AND copy_type = 'draft'", id);
        jdbc.update("DELETE FROM de_chart_view WHERE dashboard_id = ? AND copy_type = 'draft'", id);
        jdbc.update("DELETE FROM de_dashboard_linkage WHERE dashboard_id = ? AND copy_type = 'draft'", id);

        jdbc.update(
                """
                INSERT INTO de_dashboard_layout (id, dashboard_id, copy_type, grid_cols, grid_rows, theme_ref, refresh_sec, ext_style, mobile_json)
                SELECT ?, dashboard_id, 'draft', grid_cols, grid_rows, theme_ref, refresh_sec, ext_style, mobile_json
                FROM de_dashboard_layout WHERE dashboard_id = ? AND copy_type = 'published'
                """,
                nextId("de_dashboard_layout"), id
        );
        for (Map<String, Object> c : jdbc.queryForList(
                "SELECT * FROM de_dashboard_component WHERE dashboard_id = ? AND copy_type = 'published'", id)) {
            jdbc.update(
                    """
                    INSERT INTO de_dashboard_component
                    (id, dashboard_id, copy_type, type, parent_id, chart_view_id, x, y, w, h, z_index, props)
                    VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
                    """,
                    nextId("de_dashboard_component"), id, c.get("type"), c.get("parent_id"), c.get("chart_view_id"),
                    c.get("x"), c.get("y"), c.get("w"), c.get("h"), c.get("z_index"),
                    c.get("props") == null ? "{}" : String.valueOf(c.get("props"))
            );
        }
        Map<Long, Long> chartMap = new HashMap<>();
        for (Map<String, Object> ch : jdbc.queryForList(
                "SELECT * FROM de_chart_view WHERE dashboard_id = ? AND copy_type = 'published'", id)) {
            long oldId = ((Number) ch.get("id")).longValue();
            long newId = nextId("de_chart_view");
            chartMap.put(oldId, newId);
            jdbc.update(
                    """
                    INSERT INTO de_chart_view
                    (id, dashboard_id, copy_type, dataset_id, chart_type, title, encode_json, style_json, senior_json)
                    VALUES (?, ?, 'draft', ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
                    """,
                    newId, id, ch.get("dataset_id"), ch.get("chart_type"), ch.get("title"),
                    ch.get("encode_json") == null ? "{}" : String.valueOf(ch.get("encode_json")),
                    ch.get("style_json") == null ? "{}" : String.valueOf(ch.get("style_json")),
                    ch.get("senior_json") == null ? "{}" : String.valueOf(ch.get("senior_json"))
            );
        }
        for (Map.Entry<Long, Long> e : chartMap.entrySet()) {
            jdbc.update(
                    """
                    UPDATE de_dashboard_component SET chart_view_id = ?
                    WHERE dashboard_id = ? AND copy_type = 'draft' AND chart_view_id = ?
                    """,
                    e.getValue(), id, e.getKey()
            );
        }
        jdbc.update(
                "UPDATE de_dashboard SET status = 'published', update_by = ?, update_time = ? WHERE id = ?",
                AuthContext.userIdOr("system"), System.currentTimeMillis(), id
        );
        return status(id);
    }

    public Optional<DashboardShareVO> upsertShare(long dashboardId, String visibility, String perm) {
        if (findNode(dashboardId).isEmpty()) return Optional.empty();
        List<DashboardShareVO> existing = jdbc.query(
                "SELECT id, dashboard_id, token, visibility, perm, enabled, expire_at FROM de_dashboard_share WHERE dashboard_id = ? LIMIT 1",
                (rs, i) -> new DashboardShareVO(
                        String.valueOf(rs.getLong("id")),
                        String.valueOf(rs.getLong("dashboard_id")),
                        rs.getString("token"),
                        rs.getString("visibility"),
                        rs.getString("perm"),
                        rs.getShort("enabled") != 0,
                        rs.getObject("expire_at") == null ? null : rs.getLong("expire_at")
                ),
                dashboardId
        );
        if (!existing.isEmpty()) {
            DashboardShareVO cur = existing.getFirst();
            jdbc.update(
                    "UPDATE de_dashboard_share SET visibility = ?, perm = ?, enabled = 1 WHERE id = ?",
                    visibility == null ? cur.visibility() : visibility,
                    perm == null ? cur.perm() : perm,
                    Long.parseLong(cur.id())
            );
            return Optional.of(new DashboardShareVO(
                    cur.id(), cur.dashboardId(), cur.token(),
                    visibility == null ? cur.visibility() : visibility,
                    perm == null ? cur.perm() : perm,
                    true, cur.expireAt()
            ));
        }
        long sid = nextId("de_dashboard_share");
        String token = Long.toHexString(dashboardId) + Long.toHexString(System.currentTimeMillis());
        jdbc.update(
                """
                INSERT INTO de_dashboard_share
                (id, dashboard_id, token, visibility, perm, enabled, create_time)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                sid, dashboardId, token,
                visibility == null ? "org" : visibility,
                perm == null ? "view" : perm,
                System.currentTimeMillis()
        );
        return Optional.of(new DashboardShareVO(
                String.valueOf(sid), String.valueOf(dashboardId), token,
                visibility == null ? "org" : visibility,
                perm == null ? "view" : perm,
                true, null
        ));
    }

    public Optional<DashboardShareVO> findShare(long dashboardId) {
        List<DashboardShareVO> rows = jdbc.query(
                "SELECT id, dashboard_id, token, visibility, perm, enabled, expire_at FROM de_dashboard_share WHERE dashboard_id = ? LIMIT 1",
                (rs, i) -> new DashboardShareVO(
                        String.valueOf(rs.getLong("id")),
                        String.valueOf(rs.getLong("dashboard_id")),
                        rs.getString("token"),
                        rs.getString("visibility"),
                        rs.getString("perm"),
                        rs.getShort("enabled") != 0,
                        rs.getObject("expire_at") == null ? null : rs.getLong("expire_at")
                ),
                dashboardId
        );
        return rows.stream().findFirst();
    }

    private long parseId(String raw) {
        if (raw == null || raw.isBlank()) return nextId("de_dashboard_component");
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return Math.floorMod(raw.hashCode(), Integer.MAX_VALUE) + 1_000_000L;
        }
    }

    @Transactional
    public Optional<List<DashboardComponentVO>> updateComponents(long id, DashboardComponentsUpdateRequest req) {
        if (findNode(id).isEmpty()) return Optional.empty();
        ensureDraftBuckets(id);
        List<String> deleteIds = req.deleteIds() == null ? List.of() : req.deleteIds();
        for (String did : deleteIds) {
            jdbc.update(
                    "DELETE FROM de_dashboard_component WHERE dashboard_id = ? AND copy_type = 'draft' AND id = ?",
                    id, parseId(did)
            );
        }
        if (req.upsert() != null) {
            for (DashboardComponentVO c : req.upsert()) {
                long cid = parseId(c.id());
                Integer exists = jdbc.queryForObject(
                        "SELECT COUNT(*) FROM de_dashboard_component WHERE id = ? AND dashboard_id = ? AND copy_type = 'draft'",
                        Integer.class, cid, id
                );
                Long chartViewId = c.chartViewId() == null || c.chartViewId().isBlank()
                        ? null : parseId(c.chartViewId());
                long parentId = c.parentId() == null || c.parentId().isBlank() ? 0L : parseId(c.parentId());
                if (exists != null && exists > 0) {
                    jdbc.update(
                            """
                            UPDATE de_dashboard_component
                            SET type = ?, parent_id = ?, chart_view_id = ?, x = ?, y = ?, w = ?, h = ?, z_index = ?, props = ?::jsonb
                            WHERE id = ? AND dashboard_id = ? AND copy_type = 'draft'
                            """,
                            c.type(), parentId, chartViewId, c.x(), c.y(), c.w(), c.h(), c.zIndex(),
                            writeJson(c.props()), cid, id
                    );
                } else {
                    jdbc.update(
                            """
                            INSERT INTO de_dashboard_component
                            (id, dashboard_id, copy_type, type, parent_id, chart_view_id, x, y, w, h, z_index, props)
                            VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
                            """,
                            cid, id, c.type(), parentId, chartViewId, c.x(), c.y(), c.w(), c.h(), c.zIndex(),
                            writeJson(c.props())
                    );
                }
            }
        }
        bumpContent(id);
        return Optional.of(loadComponents(id, "draft"));
    }

    @Transactional
    public Optional<ChartViewVO> saveChart(long dashboardId, long chartId, ChartViewSaveRequest req) {
        if (findNode(dashboardId).isEmpty()) return Optional.empty();
        ensureDraftBuckets(dashboardId);
        Map<String, Object> encode = req.encode() == null ? Map.of() : new HashMap<>(req.encode());
        if (req.datasetId() != null) encode.put("datasetId", req.datasetId());
        Integer exists = jdbc.queryForObject(
                "SELECT COUNT(*) FROM de_chart_view WHERE id = ? AND dashboard_id = ? AND copy_type = 'draft'",
                Integer.class, chartId, dashboardId
        );
        if (exists != null && exists > 0) {
            jdbc.update(
                    """
                    UPDATE de_chart_view
                    SET chart_type = ?, title = ?, encode_json = ?::jsonb, style_json = ?::jsonb, senior_json = ?::jsonb
                    WHERE id = ? AND dashboard_id = ? AND copy_type = 'draft'
                    """,
                    req.chartType(), req.title(), writeJson(encode),
                    writeJson(req.style()), writeJson(req.senior()), chartId, dashboardId
            );
        } else {
            jdbc.update(
                    """
                    INSERT INTO de_chart_view
                    (id, dashboard_id, copy_type, dataset_id, chart_type, title, encode_json, style_json, senior_json)
                    VALUES (?, ?, 'draft', NULL, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
                    """,
                    chartId, dashboardId, req.chartType(), req.title(),
                    writeJson(encode), writeJson(req.style()), writeJson(req.senior())
            );
        }
        bumpContent(dashboardId);
        return Optional.of(new ChartViewVO(
                String.valueOf(chartId),
                String.valueOf(dashboardId),
                req.datasetId(),
                req.chartType(),
                req.title(),
                encode,
                req.style() == null ? Map.of() : req.style(),
                req.senior() == null ? Map.of() : req.senior()
        ));
    }

    @Transactional
    public Optional<DashboardStatusVO> publish(long id) {
        Optional<DashboardNodeVO> metaOpt = findNode(id);
        if (metaOpt.isEmpty()) return Optional.empty();
        ensureDraftBuckets(id);
        jdbc.update("DELETE FROM de_dashboard_layout WHERE dashboard_id = ? AND copy_type = 'published'", id);
        jdbc.update("DELETE FROM de_dashboard_component WHERE dashboard_id = ? AND copy_type = 'published'", id);
        jdbc.update("DELETE FROM de_chart_view WHERE dashboard_id = ? AND copy_type = 'published'", id);

        jdbc.update(
                """
                INSERT INTO de_dashboard_layout (id, dashboard_id, copy_type, grid_cols, grid_rows, theme_ref, refresh_sec, ext_style, mobile_json)
                SELECT ?, dashboard_id, 'published', grid_cols, grid_rows, theme_ref, refresh_sec, ext_style, mobile_json
                FROM de_dashboard_layout WHERE dashboard_id = ? AND copy_type = 'draft'
                """,
                nextId("de_dashboard_layout"), id
        );
        List<Map<String, Object>> comps = jdbc.queryForList(
                "SELECT * FROM de_dashboard_component WHERE dashboard_id = ? AND copy_type = 'draft'", id
        );
        for (Map<String, Object> c : comps) {
            long newId = nextId("de_dashboard_component");
            jdbc.update(
                    """
                    INSERT INTO de_dashboard_component
                    (id, dashboard_id, copy_type, type, parent_id, chart_view_id, x, y, w, h, z_index, props)
                    VALUES (?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
                    """,
                    newId, id, c.get("type"), c.get("parent_id"), c.get("chart_view_id"),
                    c.get("x"), c.get("y"), c.get("w"), c.get("h"), c.get("z_index"),
                    c.get("props") == null ? "{}" : String.valueOf(c.get("props"))
            );
        }
        List<Map<String, Object>> charts = jdbc.queryForList(
                "SELECT * FROM de_chart_view WHERE dashboard_id = ? AND copy_type = 'draft'", id
        );
        Map<Long, Long> chartIdMap = new HashMap<>();
        for (Map<String, Object> ch : charts) {
            long oldId = ((Number) ch.get("id")).longValue();
            long newId = nextId("de_chart_view");
            chartIdMap.put(oldId, newId);
            jdbc.update(
                    """
                    INSERT INTO de_chart_view
                    (id, dashboard_id, copy_type, dataset_id, chart_type, title, encode_json, style_json, senior_json)
                    VALUES (?, ?, 'published', ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
                    """,
                    newId, id, ch.get("dataset_id"), ch.get("chart_type"), ch.get("title"),
                    ch.get("encode_json") == null ? "{}" : String.valueOf(ch.get("encode_json")),
                    ch.get("style_json") == null ? "{}" : String.valueOf(ch.get("style_json")),
                    ch.get("senior_json") == null ? "{}" : String.valueOf(ch.get("senior_json"))
            );
        }
        // Remap published component chart_view_id to published chart ids
        for (Map.Entry<Long, Long> e : chartIdMap.entrySet()) {
            jdbc.update(
                    """
                    UPDATE de_dashboard_component SET chart_view_id = ?
                    WHERE dashboard_id = ? AND copy_type = 'published' AND chart_view_id = ?
                    """,
                    e.getValue(), id, e.getKey()
            );
        }

        DashboardNodeVO meta = metaOpt.get();
        int version = meta.version() + 1;
        jdbc.update(
                "UPDATE de_dashboard SET status = 'published', version = ?, update_time = ? WHERE id = ?",
                version, System.currentTimeMillis(), id
        );
        return status(id);
    }

    public Optional<DashboardStatusVO> status(long id) {
        return findNode(id).map(n -> new DashboardStatusVO(n.id(), n.status(), n.contentId(), n.version()));
    }

    public List<DashboardCatalogItem> listDashboardCatalog() {
        List<DashboardCatalogItem> dashboards = jdbc.query(
                """
                SELECT id, name FROM de_dashboard WHERE node_type = 'dashboard' ORDER BY id
                """,
                (rs, rowNum) -> {
                    long dashId = rs.getLong("id");
                    List<DashboardChartCatalogItem> charts = jdbc.query(
                            """
                            SELECT cv.id, cv.title, cv.chart_type, cv.encode_json
                            FROM de_chart_view cv
                            JOIN de_dashboard_component dc ON dc.chart_view_id = cv.id
                            WHERE cv.dashboard_id = ? AND cv.copy_type = 'draft'
                              AND dc.dashboard_id = ? AND dc.copy_type = 'draft'
                              AND dc.type = 'chart'
                            ORDER BY cv.id
                            """,
                            (crs, crow) -> {
                                Map<String, Object> enc = readJsonMap(crs.getString("encode_json"));
                                String datasetId = enc.get("datasetId") == null
                                        ? "ds_sales"
                                        : String.valueOf(enc.get("datasetId"));
                                return new DashboardChartCatalogItem(
                                        String.valueOf(crs.getLong("id")),
                                        crs.getString("title"),
                                        crs.getString("chart_type"),
                                        datasetId
                                );
                            },
                            dashId,
                            dashId
                    );
                    return new DashboardCatalogItem(String.valueOf(dashId), rs.getString("name"), charts);
                }
        );
        return dashboards.stream().filter(d -> !d.charts().isEmpty()).toList();
    }

    public Optional<Map<String, Object>> findChartEncode(String dashboardId, String chartId, String copyType) {
        long dashId;
        long chartNumericId;
        try {
            dashId = Long.parseLong(dashboardId);
            chartNumericId = Long.parseLong(chartId);
        } catch (NumberFormatException e) {
            return Optional.empty();
        }
        List<Map<String, Object>> rows = jdbc.query(
                """
                SELECT chart_type, title, encode_json
                FROM de_chart_view
                WHERE dashboard_id = ? AND id = ? AND copy_type = ?
                """,
                (rs, rowNum) -> {
                    Map<String, Object> enc = readJsonMap(rs.getString("encode_json"));
                    Map<String, Object> out = new HashMap<>(enc);
                    out.put("chartType", rs.getString("chart_type"));
                    out.put("title", rs.getString("title"));
                    out.put("encode", enc);
                    return out;
                },
                dashId,
                chartNumericId,
                copyType
        );
        return rows.stream().findFirst();
    }

    private void ensureDraftBuckets(long dashboardId) {
        Integer layoutN = jdbc.queryForObject(
                "SELECT COUNT(*) FROM de_dashboard_layout WHERE dashboard_id = ? AND copy_type = 'draft'",
                Integer.class, dashboardId
        );
        if (layoutN == null || layoutN == 0) {
            jdbc.update(
                    """
                    INSERT INTO de_dashboard_layout (id, dashboard_id, copy_type, grid_cols, grid_rows, mobile_json)
                    VALUES (?, ?, 'draft', 72, 36, '{"enabled":true,"device":"iphone-14","bg":"#f5f6f8","components":[]}'::jsonb)
                    """,
                    nextId("de_dashboard_layout"), dashboardId
            );
        }
    }

    private void bumpContent(long id) {
        jdbc.update(
                """
                UPDATE de_dashboard
                SET content_id = content_id + 1, update_by = ?, update_time = ?
                WHERE id = ?
                """,
                AuthContext.userIdOr("system"), System.currentTimeMillis(), id
        );
    }

    private Optional<DashboardNodeVO> findNode(long id) {
        List<DashboardNodeVO> rows = jdbc.query(
                """
                SELECT id, pid, name, node_type, status, layout_mode, content_id, version, update_time
                FROM de_dashboard WHERE id = ?
                """,
                (rs, i) -> mapNode(rs),
                id
        );
        return rows.stream().findFirst();
    }

    private DashboardNodeVO mapNode(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new DashboardNodeVO(
                String.valueOf(rs.getLong("id")),
                String.valueOf(rs.getLong("pid")),
                rs.getString("name"),
                rs.getString("node_type"),
                rs.getString("status"),
                rs.getString("layout_mode"),
                String.valueOf(rs.getLong("content_id")),
                rs.getInt("version"),
                rs.getObject("update_time") == null ? null : rs.getLong("update_time")
        );
    }

    private DashboardLayoutVO loadLayout(long id, String copy) {
        return jdbc.query(
                """
                SELECT grid_cols, grid_rows, theme_ref, refresh_sec, ext_style, mobile_json
                FROM de_dashboard_layout
                WHERE dashboard_id = ? AND copy_type = ?
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
                id, copy
        );
    }

    private List<DashboardComponentVO> loadComponents(long id, String copy) {
        return jdbc.query(
                """
                SELECT id, type, parent_id, chart_view_id, x, y, w, h, z_index, props
                FROM de_dashboard_component
                WHERE dashboard_id = ? AND copy_type = ?
                ORDER BY z_index, id
                """,
                (rs, i) -> new DashboardComponentVO(
                        String.valueOf(rs.getLong("id")),
                        rs.getString("type"),
                        String.valueOf(rs.getLong("parent_id")),
                        rs.getObject("chart_view_id") == null ? null : String.valueOf(rs.getLong("chart_view_id")),
                        rs.getInt("x"),
                        rs.getInt("y"),
                        rs.getInt("w"),
                        rs.getInt("h"),
                        rs.getInt("z_index"),
                        readJsonMap(rs.getString("props"))
                ),
                id, copy
        );
    }

    private Map<String, ChartViewVO> loadCharts(long id, String copy) {
        Map<String, ChartViewVO> out = new HashMap<>();
        jdbc.query(
                """
                SELECT id, chart_type, title, encode_json, style_json, senior_json
                FROM de_chart_view WHERE dashboard_id = ? AND copy_type = ?
                """,
                (rs) -> {
                    while (rs.next()) {
                        Map<String, Object> enc = readJsonMap(rs.getString("encode_json"));
                        String chartId = String.valueOf(rs.getLong("id"));
                        String datasetId = enc.get("datasetId") == null ? null : String.valueOf(enc.get("datasetId"));
                        out.put(chartId, new ChartViewVO(
                                chartId,
                                String.valueOf(id),
                                datasetId,
                                rs.getString("chart_type"),
                                rs.getString("title"),
                                enc,
                                readJsonMap(rs.getString("style_json")),
                                readJsonMap(rs.getString("senior_json"))
                        ));
                    }
                    return null;
                },
                id, copy
        );
        return out;
    }

    private List<BusiNodeVO> buildTree(List<DashboardNodeVO> all, String pid) {
        List<BusiNodeVO> children = new ArrayList<>();
        for (DashboardNodeVO n : all) {
            if (!pid.equals(n.pid())) continue;
            boolean leaf = "dashboard".equals(n.nodeType());
            children.add(new BusiNodeVO(
                    n.id(), n.pid(), n.name(), n.nodeType(), leaf,
                    leaf ? List.of() : buildTree(all, n.id())
            ));
        }
        return children;
    }

    private long nextId(String table) {
        Long max = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) FROM " + table, Long.class);
        return (max == null ? 0L : max) + 1;
    }

    private Map<String, Object> readJsonMap(String json) {
        if (json == null || json.isBlank()) return Map.of();
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

    private static long parseLong(String v, long fallback) {
        if (v == null || v.isBlank()) return fallback;
        try {
            return Long.parseLong(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
