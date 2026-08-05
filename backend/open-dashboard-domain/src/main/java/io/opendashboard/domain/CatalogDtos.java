package io.opendashboard.domain;

import java.util.List;
import java.util.Map;

public final class CatalogDtos {

    private CatalogDtos() {}

    public record DashboardChartCatalogItem(
            String id,
            String title,
            String chartType,
            String datasetId
    ) {}

    public record DashboardCatalogItem(
            String id,
            String name,
            List<DashboardChartCatalogItem> charts
    ) {}

    public record DatasetFieldItem(String name, String label, String group) {}

    public record DatasetCatalogItem(
            String id,
            String name,
            List<DatasetFieldItem> fields
    ) {}

    public record CatalogBundle(
            List<DashboardCatalogItem> dashboards,
            List<DatasetCatalogItem> datasets
    ) {}
}
