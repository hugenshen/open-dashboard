package io.opendashboard.application.conversation;

import io.opendashboard.application.DatasetService;
import io.opendashboard.application.StubQueryService;
import io.opendashboard.domain.ConversationDtos.ConversationAdoptRequest;
import io.opendashboard.domain.ConversationDtos.ConversationRunRequest;
import io.opendashboard.domain.ConversationDtos.ConversationRunVO;
import io.opendashboard.domain.ConversationDtos.ConversationUpdateRequest;
import io.opendashboard.domain.ConversationDtos.ConversationVO;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.QueryDtos.ChartQueryRequest;
import io.opendashboard.domain.QueryDtos.ChartQueryResult;
import io.opendashboard.domain.gateway.ConversationGateway;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Deprecated conversation-run entry. Agent runs belong on opendashboard-harness
 * (FE direct /harness/v1/conversations/{id}/runs). Java retains internal BI APIs only.
 */
@Component
public class ConversationHarness {

    public interface Emitter {
        void emit(String event, Map<String, Object> data);
    }

    private final ConversationGateway store;
    private final DatasetService datasets;
    private final DashboardPatchApplier applier;
    private final OpenAiCompatibleLlmClient llm;
    private final StubQueryService queryService;
    private final ConversationProperties props;
    private final AgentHarnessClient harnessClient;

    public ConversationHarness(
            ConversationGateway store,
            DatasetService datasets,
            DashboardPatchApplier applier,
            OpenAiCompatibleLlmClient llm,
            StubQueryService queryService,
            ConversationProperties props,
            AgentHarnessClient harnessClient
    ) {
        this.store = store;
        this.datasets = datasets;
        this.applier = applier;
        this.llm = llm;
        this.queryService = queryService;
        this.props = props;
        this.harnessClient = harnessClient;
    }

    public void startRun(
            ConversationVO conversation,
            ConversationRunVO run,
            ConversationRunRequest request,
            Emitter emitter
    ) {
        // Pi architecture: FE must call opendashboard-harness /v1/conversations/*/runs directly.
        // Java no longer proxies Agent runs; keep /api/internal/bi/* for tool execution only.
        emitter.emit("error", Map.of(
                "code", "HARNESS_DIRECT",
                "message", "Conversation runs 已迁到 opendashboard-harness。"
                        + " 请让前端直连 /harness/v1/conversations/{id}/runs（Vite 代理 :8091），"
                        + "不要再调用 /api/conversations/*/runs。"
        ));
        finish(run.id(), "error", "use_harness_direct", emitter);
    }

    private void proxyToHarness(
            ConversationVO conversation,
            ConversationRunVO run,
            ConversationRunRequest request,
            Emitter emitter
    ) {
        try {
            step(emitter, "authz", "权限校验通过");
            if (!harnessClient.available()) {
                emitter.emit("error", Map.of(
                        "code", "HARNESS_UNAVAILABLE",
                        "message", "AI harness 未启动或不可达（" + props.getHarness().getBaseUrl()
                                + "）。请启动 opendashboard-harness，或将 opendashboard.conversation.harness.mode 设为 local。"
                ));
                finish(run.id(), "error", "harness_unavailable", emitter);
                return;
            }
            List<String> datasetIds = resolveDatasets(conversation, request);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("conversationId", conversation.id());
            payload.put("runId", run.id());
            payload.put("message", request.message());
            payload.put("intent", request.intent());
            payload.put("mode", request.mode() == null ? run.mode() : request.mode());
            payload.put("styleId", request.styleId() == null ? run.styleId() : request.styleId());
            payload.put("datasetIds", datasetIds);
            payload.put("linkedDashboardId", conversation.linkedDashboardId());
            payload.put("selectedChartId", request.selectedChartId());
            payload.put("selectedEncode", request.selectedEncode());
            Emitter tracking = (event, data) -> {
                if ("finish".equals(event) && data != null) {
                    String reason = String.valueOf(data.getOrDefault("reason", "done"));
                    String detail = data.get("detail") == null ? null : String.valueOf(data.get("detail"));
                    String status = "done".equals(reason) || "answered".equals(reason) || "awaiting_confirm".equals(reason)
                            ? reason
                            : "error".equals(reason) ? "error" : reason;
                    store.updateRun(run.id(), status, null, reason, detail);
                }
                if ("board_ready".equals(event) && data != null && data.get("dashboardId") != null) {
                    store.update(conversation.id(), new ConversationUpdateRequest(
                            null, null, null, String.valueOf(data.get("dashboardId"))
                    ));
                }
                if ("message_delta".equals(event) && data != null && data.get("text") != null) {
                    store.appendMessage(conversation.id(), "assistant", String.valueOf(data.get("text")), List.of());
                }
                emitter.emit(event, data);
            };
            harnessClient.proxyRun(payload, tracking);
        } catch (Exception e) {
            emitter.emit("error", Map.of(
                    "code", "HARNESS_PROXY",
                    "message", e.getMessage() == null ? e.toString() : e.getMessage()
            ));
            finish(run.id(), "error", "harness_proxy", emitter);
        }
    }

    /** Deterministic non-LLM fallback when harness.mode=local. */
    private void startLocalRun(
            ConversationVO conversation,
            ConversationRunVO run,
            ConversationRunRequest request,
            Emitter emitter
    ) {
        try {
            step(emitter, "authz", "权限校验通过");
            List<String> datasetIds = resolveDatasets(conversation, request);
            step(emitter, "context", "会话上下文已加载（local 模式）");

            Map<String, DatasetDetailVO> loaded = new HashMap<>();
            for (String id : datasetIds) {
                datasets.get(id).ifPresent(d -> loaded.put(id, d));
            }
            SchemaGuard.SchemaBundle schema = SchemaGuard.load(datasetIds, loaded);
            step(emitter, "schema", schema.okForPagePatch()
                    ? "Schema Guard 通过（" + schema.byId().size() + " 个数据集）"
                    : "Schema 缺失: " + String.join(",", schema.missingIds()));

            if (!schema.okForPagePatch()) {
                emitter.emit("error", Map.of(
                        "code", "SCHEMA_GUARD",
                        "message", "未读到可用数据集 Schema，禁止问数/写入。请先绑定数据集。"
                ));
                finish(run.id(), "error", "schema_guard", emitter);
                return;
            }

            if (request.selectedEncode() != null && !request.selectedEncode().isEmpty()) {
                step(emitter, "evidence", "已纳入选中图 encode 证据");
            }

            String intent = AskAnswerPlanner.resolveIntent(request.intent(), request.message());
            step(emitter, "intent", "意图: " + intent);

            if ("ask".equals(intent) || "insight".equals(intent)) {
                IntentResolver.Plan intentPlan = IntentResolver.resolve(request.message(), schema);
                emitter.emit("intent_map", intentPlan.toMap());
                step(emitter, "intent_map", intentPlan.needsClarify()
                        ? "意图未完全对齐，需要澄清"
                        : "已对齐 " + intentPlan.mapping().size() + " 个短语");
                answerAskOrInsight(conversation, run, request, schema, intent, emitter);
                return;
            }

            DashboardPatch.Patch patch = buildPatch(
                    conversation.linkedDashboardId(),
                    request.styleId() == null ? run.styleId() : request.styleId(),
                    request.message(),
                    schema,
                    emitter
            );

            String mode = run.mode() == null ? "auto" : run.mode().toLowerCase();
            if ("plan".equals(mode)) {
                Map<String, Object> plan = DeterministicPlanner.planSummary(patch, request.message());
                store.updateRun(run.id(), "awaiting_confirm", plan, null, null);
                emitter.emit("plan", plan);
                emitter.emit("finish", Map.of("reason", "awaiting_confirm", "detail", "等待确认计划"));
                return;
            }

            applyAndPreview(conversation, run, request.message(), patch, emitter);
        } catch (Exception e) {
            emitter.emit("error", Map.of("code", "HARNESS", "message", e.getMessage() == null ? e.toString() : e.getMessage()));
            finish(run.id(), "error", "exception", emitter);
        }
    }

    public void adoptAnswer(
            ConversationVO conversation,
            ConversationRunVO run,
            ConversationAdoptRequest request,
            Emitter emitter
    ) {
        try {
            Map<String, Object> plan = run.plan();
            if (plan == null || !(plan.get("answer") instanceof Map<?, ?>)) {
                emitter.emit("error", Map.of("code", "NO_ANSWER", "message", "无可采纳的问数/洞察结果"));
                finish(run.id(), "error", "no_answer", emitter);
                return;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> answerMap = (Map<String, Object>) plan.get("answer");
            AskAnswerPlanner.Answer answer = answerFromMap(answerMap);
            String action = request == null || request.action() == null || request.action().isBlank()
                    ? "save"
                    : request.action().trim().toLowerCase();
            String styleId = request != null && request.styleId() != null && !request.styleId().isBlank()
                    ? request.styleId()
                    : run.styleId();

            step(emitter, "adopt", "save".equals(action) ? "保存本题到仪表盘" : "从本题生成整页看板");

            DashboardPatch.Patch patch;
            if ("generate".equals(action)) {
                List<String> datasetIds = List.of(answer.datasetId());
                Map<String, DatasetDetailVO> loaded = new HashMap<>();
                for (String id : datasetIds) {
                    datasets.get(id).ifPresent(d -> loaded.put(id, d));
                }
                SchemaGuard.SchemaBundle schema = SchemaGuard.load(datasetIds, loaded);
                if (!schema.okForPagePatch()) {
                    emitter.emit("error", Map.of("code", "SCHEMA_GUARD", "message", "数据集不可用，无法生成看板"));
                    finish(run.id(), "error", "schema_guard", emitter);
                    return;
                }
                String msg = answer.title() + " · " + (plan.get("message") == null ? "" : plan.get("message"));
                patch = DeterministicPlanner.plan(conversation.linkedDashboardId(), styleId, msg, schema);
            } else {
                patch = AskAnswerPlanner.toSavePatch(answer, styleId);
            }

            applyAndPreview(conversation, run, "adopt:" + action, patch, emitter);
        } catch (Exception e) {
            emitter.emit("error", Map.of("code", "HARNESS", "message", e.getMessage() == null ? e.toString() : e.getMessage()));
            finish(run.id(), "error", "exception", emitter);
        }
    }

    public void confirmPlan(ConversationVO conversation, ConversationRunVO run, Emitter emitter) {
        try {
            Map<String, Object> plan = run.plan();
            if (plan == null || !(plan.get("patch") instanceof Map<?, ?>)) {
                emitter.emit("error", Map.of("code", "NO_PLAN", "message", "无可确认的计划"));
                finish(run.id(), "error", "no_plan", emitter);
                return;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> patchMap = (Map<String, Object>) plan.get("patch");
            DashboardPatch.Patch patch = DashboardPatch.Patch.fromMap(patchMap);
            String message = plan.get("summary") == null ? "" : String.valueOf(plan.get("summary"));
            applyAndPreview(conversation, run, message, patch, emitter);
        } catch (Exception e) {
            emitter.emit("error", Map.of("code", "HARNESS", "message", e.getMessage() == null ? e.toString() : e.getMessage()));
            finish(run.id(), "error", "exception", emitter);
        }
    }

    private void answerAskOrInsight(
            ConversationVO conversation,
            ConversationRunVO run,
            ConversationRunRequest request,
            SchemaGuard.SchemaBundle schema,
            String intent,
            Emitter emitter
    ) {
        step(emitter, "plan", "insight".equals(intent) ? "确定性洞察规划" : "确定性问数规划");
        AskAnswerPlanner.Answer answer = "insight".equals(intent)
                ? AskAnswerPlanner.planInsight(request.message(), schema)
                : AskAnswerPlanner.planAsk(request.message(), schema);

        if (answer.needsClarify()) {
            step(emitter, "clarify", "问题不明确，返回澄清");
            Map<String, Object> clarifyEvt = new LinkedHashMap<>();
            clarifyEvt.put("title", answer.title());
            clarifyEvt.put("headlineHtml", answer.headlineHtml());
            clarifyEvt.put("insightHtml", answer.insightHtml());
            clarifyEvt.put("follows", answer.follows());
            clarifyEvt.put("question", request.message());
            emitter.emit("answer_clarify", clarifyEvt);

            Map<String, Object> plan = new LinkedHashMap<>();
            plan.put("intent", "clarify");
            plan.put("message", request.message());
            plan.put("answer", answer.toMap());
            store.updateRun(run.id(), "answered", plan, "answered", "clarify");

            String plain = stripHtml(answer.insightHtml());
            emitter.emit("message_delta", Map.of("text", plain));
            store.appendMessage(conversation.id(), "assistant", plain, List.of(Map.of(
                    "kind", "clarify",
                    "title", answer.title(),
                    "follows", answer.follows()
            )));
            emitter.emit("finish", Map.of("reason", "answered", "detail", "clarify"));
            return;
        }

        step(emitter, "preview", "预览 chartQuery（不落结果行）");
        Map<String, Object> inline = new LinkedHashMap<>();
        inline.put("datasetId", answer.datasetId());
        inline.put("chartType", answer.chartType());
        inline.put("encode", answer.encode());
        ChartQueryResult result = queryService.query(new ChartQueryRequest(
                "ask-preview", null, "draft", inline, Map.of()
        ));

        List<String> columns = new ArrayList<>();
        if (result.fields() != null) {
            for (var f : result.fields()) {
                columns.add(f.name());
            }
        }
        List<List<Object>> rows = result.data() == null ? List.of() : result.data();
        int rowCount = rows.size();
        List<String> labels = new ArrayList<>();
        double max = 1;
        for (List<Object> row : rows) {
            if (row == null || row.isEmpty()) continue;
            labels.add(String.valueOf(row.getFirst()));
            if (row.size() > 1) {
                max = Math.max(max, Math.abs(toDouble(row.get(1))));
            }
        }
        List<Integer> heights = new ArrayList<>();
        for (List<Object> row : rows) {
            if (row == null || row.size() < 2) {
                heights.add(12);
                continue;
            }
            heights.add((int) Math.round(Math.max(8, Math.abs(toDouble(row.get(1))) / max * 100)));
        }

        Map<String, Object> tableEvt = new LinkedHashMap<>();
        tableEvt.put("title", answer.title() + " · 明细");
        tableEvt.put("columns", columns);
        tableEvt.put("rows", rows.size() > 12 ? rows.subList(0, 12) : rows);
        tableEvt.put("rowCount", rowCount);
        tableEvt.put("truncated", rowCount > 12);
        emitter.emit("answer_table", tableEvt);

        String dsName = schema.byId().containsKey(answer.datasetId())
                && schema.byId().get(answer.datasetId()).meta() != null
                ? schema.byId().get(answer.datasetId()).meta().name()
                : answer.datasetId();

        Map<String, Object> chartEvt = new LinkedHashMap<>();
        chartEvt.put("title", answer.title());
        chartEvt.put("chartType", answer.chartType());
        chartEvt.put("datasetId", answer.datasetId());
        chartEvt.put("datasetName", dsName);
        chartEvt.put("encode", answer.encode());
        chartEvt.put("fields", result.fields());
        chartEvt.put("rowCount", rowCount);
        chartEvt.put("labels", labels.size() > 12 ? labels.subList(0, 12) : labels);
        chartEvt.put("heights", heights.size() > 12 ? heights.subList(0, 12) : heights);
        chartEvt.put("insightHtml", answer.insightHtml());
        chartEvt.put("question", request.message());
        chartEvt.put("follows", answer.follows());
        chartEvt.put("series", result.series() == null ? Map.of() : result.series());
        emitter.emit("answer_chart", chartEvt);

        if ("insight".equals(intent)) {
            Map<String, Object> insightEvt = new LinkedHashMap<>();
            insightEvt.put("title", answer.title());
            insightEvt.put("headlineHtml", answer.headlineHtml());
            insightEvt.put("insightHtml", answer.insightHtml());
            insightEvt.put("drivers", answer.drivers());
            insightEvt.put("follows", answer.follows());
            insightEvt.put("question", request.message());
            insightEvt.put("datasetName", dsName);
            emitter.emit("answer_insight", insightEvt);
        }

        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("intent", intent);
        plan.put("message", request.message());
        plan.put("answer", answer.toMap());
        plan.put("preview", Map.of("columns", columns, "rowCount", rowCount));
        store.updateRun(run.id(), "answered", plan, "answered", intent);

        String assistantText = "insight".equals(intent)
                ? stripHtml(answer.headlineHtml()) + " " + stripHtml(answer.insightHtml())
                : stripHtml(answer.insightHtml()) + "（会话预览，未写入看板）";
        emitter.emit("message_delta", Map.of("text", assistantText.trim()));
        store.appendMessage(
                conversation.id(),
                "assistant",
                assistantText.trim(),
                List.of(Map.of(
                        "kind", intent,
                        "title", answer.title(),
                        "datasetId", answer.datasetId(),
                        "chartType", answer.chartType(),
                        "follows", answer.follows()
                ))
        );
        emitter.emit("finish", Map.of("reason", "answered", "detail", intent));
    }

    private static String stripHtml(String html) {
        if (html == null) return "";
        return html.replaceAll("<[^>]+>", "").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").trim();
    }

    private static double toDouble(Object o) {
        if (o instanceof Number n) return n.doubleValue();
        try {
            return Double.parseDouble(String.valueOf(o).replace(",", ""));
        } catch (Exception e) {
            return 0;
        }
    }

    /** KPI [[null]] / empty bar groups count as empty preview. */
    private static boolean isPreviewEmpty(String chartType, List<List<Object>> data) {
        if (data == null || data.isEmpty()) return true;
        if ("kpi".equals(chartType)) {
            List<Object> row = data.getFirst();
            if (row == null || row.isEmpty()) return true;
            Object v = row.size() > 1 ? row.get(1) : row.getFirst();
            return v == null;
        }
        return false;
    }

    private void applyAndPreview(
            ConversationVO conversation,
            ConversationRunVO run,
            String message,
            DashboardPatch.Patch patch,
            Emitter emitter
    ) {
        store.updateRun(run.id(), "applying", run.plan(), null, null);
        emitter.emit("patch", patch.toMap());
        step(emitter, "validate", "校验 Patch ops");

        List<String> datasetIds = new ArrayList<>();
        for (Map<String, Object> op : patch.ops()) {
            if ("upsert_chart".equals(String.valueOf(op.get("op"))) && op.get("datasetId") != null) {
                datasetIds.add(String.valueOf(op.get("datasetId")));
            }
        }
        Map<String, DatasetDetailVO> loaded = new HashMap<>();
        for (String id : datasetIds) {
            datasets.get(id).ifPresent(d -> loaded.put(id, d));
        }
        SchemaGuard.SchemaBundle schema = SchemaGuard.load(datasetIds, loaded);
        List<String> errors = SchemaGuard.validateOps(patch.ops(), schema);
        if (!errors.isEmpty()) {
            emitter.emit("error", Map.of("code", "VALIDATE", "message", String.join("; ", errors)));
            finish(run.id(), "error", "validate", emitter);
            return;
        }

        step(emitter, "apply", "写入 Dashboard draft");
        DashboardPatchApplier.ApplyResult applied = applier.apply(
                conversation.linkedDashboardId(),
                DeterministicPlanner.resolveTitle(message, schema),
                patch
        );

        if (conversation.linkedDashboardId() == null
                || conversation.linkedDashboardId().isBlank()
                || !conversation.linkedDashboardId().equals(applied.dashboardId())) {
            store.update(conversation.id(), new io.opendashboard.domain.ConversationDtos.ConversationUpdateRequest(
                    null, null, null, applied.dashboardId()
            ));
        }

        store.createRevision(
                conversation.id(),
                run.id(),
                applied.dashboardId(),
                patch.toMap(),
                applied.snapshot(),
                "run " + run.id()
        );

        step(emitter, "preview", "预览 chartQuery");
        String boardTitle = DeterministicPlanner.resolveTitle(message, schema);
        List<Map<String, Object>> previewCards = new ArrayList<>();
        int emptyCharts = 0;
        for (String chartId : applied.chartIds()) {
            Map<String, Object> inline = findChartInline(patch, chartId);
            ChartQueryResult result = queryService.query(new ChartQueryRequest(
                    chartId, applied.dashboardId(), "draft", inline.isEmpty() ? null : inline, Map.of()
            ));
            List<List<Object>> data = result.data() == null ? List.of() : result.data();
            String chartType = String.valueOf(inline.getOrDefault("chartType", "bar"));
            boolean chartEmpty = isPreviewEmpty(chartType, data);
            if (chartEmpty) emptyCharts++;
            List<String> labels = new ArrayList<>();
            double max = 1;
            for (List<Object> row : data) {
                if (row == null || row.isEmpty()) continue;
                Object head = row.getFirst();
                if (head == null) continue;
                labels.add(String.valueOf(head));
                if (row.size() > 1) max = Math.max(max, Math.abs(toDouble(row.get(1))));
            }
            List<Integer> heights = new ArrayList<>();
            for (List<Object> row : data) {
                if (row == null || row.size() < 2 || row.get(1) == null) {
                    heights.add(12);
                    continue;
                }
                heights.add((int) Math.round(Math.max(8, Math.abs(toDouble(row.get(1))) / max * 100)));
            }
            Map<String, Object> ready = new LinkedHashMap<>();
            ready.put("chartId", chartId);
            ready.put("dashboardId", applied.dashboardId());
            ready.put("boardTitle", boardTitle);
            ready.put("title", inline.getOrDefault("title", chartId));
            ready.put("chartType", chartType);
            ready.put("datasetId", inline.get("datasetId"));
            ready.put("encode", inline.getOrDefault("encode", Map.of()));
            ready.put("fields", result.fields());
            ready.put("rowCount", chartEmpty ? 0 : data.size());
            ready.put("labels", labels.size() > 8 ? labels.subList(0, 8) : labels);
            ready.put("heights", heights.size() > 8 ? heights.subList(0, 8) : heights);
            if ("kpi".equals(chartType) && !data.isEmpty() && !data.getFirst().isEmpty()) {
                Object raw = data.getFirst().size() > 1 ? data.getFirst().get(1) : data.getFirst().getFirst();
                ready.put("kpiValue", raw == null ? 0 : raw);
            }
            previewCards.add(ready);
            emitter.emit("chart_ready", ready);
        }

        boolean allEmpty = !previewCards.isEmpty() && emptyCharts == previewCards.size();
        emitter.emit("board_ready", Map.of(
                "dashboardId", applied.dashboardId(),
                "title", boardTitle,
                "chartCount", previewCards.size(),
                "emptyPreview", allEmpty
        ));

        String boardHint;
        if (previewCards.isEmpty()) {
            boardHint = "已生成看板草稿 #" + applied.dashboardId();
        } else if (allEmpty) {
            boardHint = "已生成「" + boardTitle + "」草稿 #" + applied.dashboardId()
                    + "，但预览无有效数据（表可能为空或聚合为 null）。请换有数据的业务数据集（如订单表），或检查数据源表是否有行。";
        } else {
            boardHint = "已生成「" + boardTitle + "」看板草稿 #" + applied.dashboardId() + "，含 "
                    + previewCards.size() + " 个组件。可在编辑器继续精修。";
        }
        emitter.emit("message_delta", Map.of("text", boardHint));
        store.appendMessage(
                conversation.id(),
                "assistant",
                boardHint,
                List.of(Map.of(
                        "dashboardId", applied.dashboardId(),
                        "boardTitle", boardTitle,
                        "chartIds", applied.chartIds(),
                        "charts", previewCards.stream().map(c -> Map.of(
                                "chartId", c.get("chartId"),
                                "title", c.get("title"),
                                "chartType", c.get("chartType")
                        )).toList()
                ))
        );
        finish(run.id(), "done", "applied:" + applied.dashboardId(), emitter);
    }

    private DashboardPatch.Patch buildPatch(
            String dashboardId,
            String styleId,
            String message,
            SchemaGuard.SchemaBundle schema,
            Emitter emitter
    ) {
        step(emitter, "plan", llm.isEnabled() ? "调用 LLM 规划 Patch" : "确定性规划器");
        Optional<DashboardPatch.Patch> fromLlm = llm.proposePatch(dashboardId, styleId, message, schema);
        if (fromLlm.isPresent()) {
            step(emitter, "plan", "LLM Patch 已通过 Schema Guard");
            return fromLlm.get();
        }
        if (llm.isEnabled()) {
            step(emitter, "plan", "LLM 失败，回退确定性规划器");
        }
        return DeterministicPlanner.plan(dashboardId, styleId, message, schema);
    }

    @SuppressWarnings("unchecked")
    private static AskAnswerPlanner.Answer answerFromMap(Map<String, Object> m) {
        List<Map<String, Object>> drivers = List.of();
        if (m.get("drivers") instanceof List<?> list) {
            List<Map<String, Object>> tmp = new ArrayList<>();
            for (Object o : list) {
                if (o instanceof Map<?, ?> dm) {
                    tmp.add((Map<String, Object>) dm);
                }
            }
            drivers = tmp;
        }
        List<String> follows = List.of();
        if (m.get("follows") instanceof List<?> fl) {
            follows = fl.stream().map(String::valueOf).toList();
        }
        Map<String, Object> encode = m.get("encode") instanceof Map<?, ?> em
                ? (Map<String, Object>) em
                : Map.of();
        Map<String, Object> patchHint = m.get("patchHint") instanceof Map<?, ?> pm
                ? (Map<String, Object>) pm
                : Map.of();
        return new AskAnswerPlanner.Answer(
                String.valueOf(m.getOrDefault("kind", "ask")),
                String.valueOf(m.getOrDefault("title", "问数结果")),
                String.valueOf(m.getOrDefault("insightHtml", "")),
                String.valueOf(m.getOrDefault("headlineHtml", "")),
                String.valueOf(m.getOrDefault("datasetId", "")),
                String.valueOf(m.getOrDefault("chartType", "bar")),
                encode,
                drivers,
                follows,
                patchHint
        );
    }

    private static Map<String, Object> findChartInline(DashboardPatch.Patch patch, String chartId) {
        for (Map<String, Object> op : patch.ops()) {
            if (!"upsert_chart".equals(String.valueOf(op.get("op")))) continue;
            if (!chartId.equals(String.valueOf(op.get("chartId")))) continue;
            Map<String, Object> inline = new LinkedHashMap<>();
            inline.put("datasetId", op.get("datasetId"));
            inline.put("chartType", op.get("type"));
            inline.put("title", op.get("title"));
            inline.put("encode", op.get("encode"));
            return inline;
        }
        return Map.of();
    }

    private List<String> resolveDatasets(ConversationVO conversation, ConversationRunRequest request) {
        if (request.datasetIds() != null && !request.datasetIds().isEmpty()) {
            return new ArrayList<>(request.datasetIds());
        }
        if (conversation.datasetIds() != null && !conversation.datasetIds().isEmpty()) {
            return new ArrayList<>(conversation.datasetIds());
        }
        // Do not silently default to ds_sales — require an explicit dataset binding.
        return List.of();
    }

    private void step(Emitter emitter, String id, String label) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", id);
        data.put("label", label);
        emitter.emit("step", data);
    }

    private void finish(String runId, String status, String detail, Emitter emitter) {
        String reason = "done".equals(status) ? "done" : status;
        store.updateRun(runId, status, null, reason, detail);
        emitter.emit("finish", Map.of("reason", reason, "detail", detail == null ? "" : detail));
    }
}
