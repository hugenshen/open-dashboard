package io.opendashboard.adapter.security;

import io.opendashboard.application.conversation.ConversationProperties;
import io.opendashboard.domain.context.AuthPrincipal;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
@Primary
@ConditionalOnBean(JdbcTemplate.class)
public class JdbcMenuProvider implements MenuProvider {

    private final JdbcTemplate jdbc;
    private final ConversationProperties conversationProperties;

    public JdbcMenuProvider(JdbcTemplate jdbc, ConversationProperties conversationProperties) {
        this.jdbc = jdbc;
        this.conversationProperties = conversationProperties;
    }

    @Override
    public List<MenuItem> menus(AuthPrincipal principal) {
        List<MenuRow> rows = jdbc.query("""
                SELECT menu_key, label, path, group_name
                FROM od_menu_item
                WHERE enabled = TRUE
                ORDER BY ord, menu_key
                """, (rs, i) -> new MenuRow(
                rs.getString("menu_key"),
                rs.getString("label"),
                rs.getString("path"),
                rs.getString("group_name")
        ));
        Map<String, List<String>> required = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT menu_key, permission_code
                FROM od_menu_permission
                ORDER BY menu_key, permission_code
                """)) {
            required.computeIfAbsent(String.valueOf(row.get("menu_key")), k -> new ArrayList<>())
                    .add(String.valueOf(row.get("permission_code")));
        }
        List<MenuItem> out = new ArrayList<>();
        for (MenuRow row : rows) {
            if ("conversations".equals(row.key()) && conversationProperties != null && !conversationProperties.isEnabled()) {
                continue;
            }
            List<String> perms = required.getOrDefault(row.key(), List.of());
            if (perms.isEmpty() || perms.stream().anyMatch(principal::hasPermission)) {
                out.add(new MenuItem(row.key(), row.label(), row.path(), row.group()));
            }
        }
        return List.copyOf(out);
    }

    private record MenuRow(String key, String label, String path, String group) {}
}
