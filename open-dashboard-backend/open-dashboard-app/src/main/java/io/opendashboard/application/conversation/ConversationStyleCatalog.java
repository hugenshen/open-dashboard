package io.opendashboard.application.conversation;

import io.opendashboard.domain.ConversationDtos.StylePresetVO;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class ConversationStyleCatalog {

    private ConversationStyleCatalog() {}

    public static List<StylePresetVO> list() {
        return List.of(
                style("feishu-blue", "默认飞书蓝", "与产品顶栏一致的清晰商务风",
                        Map.of("accent", "#3370ff", "bg", "#f5f6f8", "density", "comfortable")),
                style("ops-daily", "经营日报", "KPI 突出、信息密度中等",
                        Map.of("accent", "#1f6feb", "bg", "#f7f8fa", "density", "compact")),
                style("finance-minimal", "财务极简", "留白多、字重克制",
                        Map.of("accent", "#0f766e", "bg", "#fafafa", "density", "airy")),
                style("monitor-dark", "监控深色", "深底高对比，适合值班墙",
                        Map.of("accent", "#38bdf8", "bg", "#0f172a", "density", "compact", "theme", "dark")),
                style("report-clean", "汇报清爽", "浅底、适合截图发群",
                        Map.of("accent", "#2563eb", "bg", "#ffffff", "density", "comfortable"))
        );
    }

    public static StylePresetVO get(String id) {
        String key = id == null || id.isBlank() ? "feishu-blue" : id.trim();
        return list().stream().filter(s -> s.id().equals(key)).findFirst().orElse(list().getFirst());
    }

    private static StylePresetVO style(String id, String name, String desc, Map<String, Object> tokens) {
        return new StylePresetVO(id, name, desc, new LinkedHashMap<>(tokens));
    }
}
