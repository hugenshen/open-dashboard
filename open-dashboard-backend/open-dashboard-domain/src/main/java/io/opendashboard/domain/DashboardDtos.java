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

    public record DashboardLinkageVO(
            String id,
            String sourceChartId,
            String sourceField,
            String targetChartId,
            String targetField,
            boolean enabled
    ) {}

    public record DashboardDetailVO(
            DashboardNodeVO meta,
            DashboardLayoutVO layout,
            List<DashboardComponentVO> components,
            Map<String, ChartViewVO> charts,
            List<DashboardLinkageVO> linkages
    ) {}

    public record DashboardShareVO(
            String id,
            String dashboardId,
            String token,
            String visibility,
            String perm,
            boolean enabled,
            Long expireAt
    ) {}

    /** Token 分享观看页：已发布详情 + 分享元数据 + 关联数据集 */
    public record ShareViewVO(
            DashboardShareVO share,
            DashboardDetailVO detail,
            java.util.List<io.opendashboard.domain.DatasetDtos.DatasetDetailVO> datasets
    ) {}

    public record BusiNodeRequest(String busiFlag, String id) {}

    public record BusiNodeVO(
            String id,
            String pid,
            String name,
            String nodeType,
            boolean leaf,
            List<BusiNodeVO> children
    ) {}

    public record DashboardCreateRequest(
            String pid,
            String name,
            String nodeType,
            String layoutMode,
            String templateId
    ) {}

    public record DashboardTemplateVO(
            String id,
            String name,
            String domain,
            String description,
            String category,
            String thumbnail,
            boolean responsive,
            boolean recommended
    ) {
        public DashboardTemplateVO(String id, String name, String domain, String description) {
            this(id, name, domain, description, domain, null, false, false);
        }
    }

    public record DashboardRenameRequest(String id, String name) {}

    public record DashboardMoveRequest(String id, String pid) {}

    public record DashboardBarVO(
            String id,
            String name,
            String nodeType,
            String status,
            String createBy,
            Long createTime,
            String updateBy,
            Long updateTime,
            int chartCount
    ) {}

    public record DashboardLayoutUpdateRequest(
            Integer gridCols,
            Integer gridRows,
            String themeRef,
            Integer refreshSec,
            Map<String, Object> extStyle,
            Map<String, Object> mobile,
            String contentId
    ) {}

    public record DashboardComponentsUpdateRequest(
            List<DashboardComponentVO> upsert,
            List<String> deleteIds,
            String contentId
    ) {}

    public record ChartViewSaveRequest(
            String datasetId,
            String chartType,
            String title,
            Map<String, Object> encode,
            Map<String, Object> style,
            Map<String, Object> senior,
            String contentId
    ) {}

    public record DashboardStatusVO(
            String id,
            String status,
            String contentId,
            int version
    ) {}
}
