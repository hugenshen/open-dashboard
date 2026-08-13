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
        items.add(new MenuItem("workbench", "工作台", "/workbench"));
        if (conversationProperties != null && conversationProperties.isEnabled()) {
            items.add(new MenuItem("conversations", "对话", "/conversations"));
        }
        items.add(new MenuItem("datasources", "数据源", "/datasources"));
        items.add(new MenuItem("datasets", "数据集", "/datasets"));
        items.add(new MenuItem("dashboards", "仪表盘", "/dashboards"));
        items.add(new MenuItem("reports", "报告", "/reports"));
        return List.copyOf(items);
    }
}
