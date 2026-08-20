package io.opendashboard.adapter.security;

import io.opendashboard.application.conversation.ConversationProperties;
import io.opendashboard.domain.context.AuthPrincipal;

import java.util.ArrayList;
import java.util.List;

public class DefaultMenuProvider implements MenuProvider {

    private final ConversationProperties conversationProperties;

    public DefaultMenuProvider(ConversationProperties conversationProperties) {
        this.conversationProperties = conversationProperties;
    }

    public DefaultMenuProvider() {
        this(new ConversationProperties());
    }

    @Override
    public List<MenuItem> menus(AuthPrincipal principal) {
        List<MenuItem> items = new ArrayList<>();
        items.add(new MenuItem("workbench", "工作台", "/workbench", "use"));
        items.add(new MenuItem("dataPlaza", "数据广场", "/data-plaza", "use"));
        if (conversationProperties != null && conversationProperties.isEnabled()) {
            items.add(new MenuItem("conversations", "对话分析", "/conversations", "use"));
        }
        if (principal.hasPermission("dashboard:view") || principal.hasPermission("dashboard:manage")) {
            items.add(new MenuItem("dashboards", "仪表盘", "/dashboards", "use"));
        }
        if (principal.hasPermission("report:view") || principal.hasPermission("report:manage")) {
            items.add(new MenuItem("reports", "报告", "/reports", "use"));
        }
        if (principal.hasPermission("datasource:manage") || principal.hasPermission("dataset:manage")) {
            items.add(new MenuItem("datasources", "数据源", "/datasources", "manage"));
        }
        if (principal.hasPermission("dataset:manage")) {
            items.add(new MenuItem("datasets", "数据集", "/datasets", "manage"));
            items.add(new MenuItem("dimensions", "知识维护", "/dimensions", "manage"));
        }
        if (principal.hasPermission("workspace:admin") || principal.hasPermission("workspace:manage_member")) {
            items.add(new MenuItem("workspaceAdmin", "成员权限", "/workspace-admin", "manage"));
        }
        return List.copyOf(items);
    }
}
