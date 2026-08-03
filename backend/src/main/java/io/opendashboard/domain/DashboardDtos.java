package io.opendashboard.domain;

import java.util.List;
import java.util.Map;

public final class DashboardDtos {

    private DashboardDtos() {}

    public record DashboardNodeVO(
            String id,
            String pid,
            String name,
            String nodeType,
            String status,
            String layoutMode,
            String contentId,
            int version,
            Long updateTime
    ) {}

    public record DashboardLayoutVO(
            int gridCols,
            int gridRows,
            String themeRef,
            Integer refreshSec,
            Map<String, Object> extStyle,
            Map<String, Object> mobile
    ) {}

    public record DashboardComponentVO(
            String id,
            String type,
            String parentId,
            String chartViewId,
            int x,
            int y,
            int w,
            int h,
            int zIndex,
            Map<String, Object> props
    ) {}

    public record ChartViewVO(
            String id,
            String dashboardId,
            String datasetId,
            String chartType,
            String title,
            Map<String, Object> encode,
            Map<String, Object> style,
            Map<String, Object> senior
    ) {}

    public record DashboardDetailVO(
            DashboardNodeVO meta,
            DashboardLayoutVO layout,
            List<DashboardComponentVO> components,
            Map<String, ChartViewVO> charts,
            List<Object> linkages
    ) {}
}
