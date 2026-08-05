package io.opendashboard.adapter.security;

import io.opendashboard.domain.context.AuthPrincipal;

import java.util.List;

public class DefaultMenuProvider implements MenuProvider {

    private static final List<MenuItem> DEFAULT = List.of(
            new MenuItem("datasources", "数据源", "/datasources"),
            new MenuItem("datasets", "数据集", "/datasets"),
            new MenuItem("dashboards", "仪表盘", "/dashboards"),
            new MenuItem("reports", "报告", "/reports")
    );

    @Override
    public List<MenuItem> menus(AuthPrincipal principal) {
        return DEFAULT;
    }
}
