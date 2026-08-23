package io.opendashboard.domain;

import java.util.List;
import java.util.Map;

public final class DatasetPermissionDtos {

    private DatasetPermissionDtos() {}

    public record MemberOption(String userId, String displayName, String username, List<String> roles) {}

    public record GrantVO(
            String id,
            String datasetId,
            String subjectType,
            String subjectId,
            String subjectLabel,
            String action
    ) {}

    public record PolicyVO(
            String id,
            String datasetId,
            String subjectType,
            String subjectId,
            String subjectLabel,
            String kind,
            String effect,
            Map<String, Object> predicate,
            boolean enabled
    ) {}

    public record DatasetPermissionBundle(
            List<Map<String, String>> datasets,
            List<MemberOption> members,
            List<GrantVO> grants,
            List<PolicyVO> policies
    ) {}

    public record GrantRequest(
            String datasetId,
            String subjectType,
            String subjectId,
            String action,
            String rowField,
            String rowOp,
            String rowValue,
            List<String> hideColumns
    ) {}
}
