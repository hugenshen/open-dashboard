package io.opendashboard.domain;

import java.util.Map;

public final class ReportDtos {

    private ReportDtos() {}

    public record ReportMetaVO(
            String id,
            String name,
            String status,
            String contentId,
            int version,
            Long updateTime
    ) {}

    public record ReportDetailVO(
            ReportMetaVO meta,
            Map<String, Object> content
    ) {}

    public record ReportCreateRequest(String name) {}

    public record ReportMetaUpdateRequest(
            String name,
            String folder,
            String desc
    ) {}

    public record ReportDocUpdateRequest(
            Map<String, Object> content,
            String contentId
    ) {}
}
