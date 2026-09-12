package io.opendashboard.domain.gateway;

import io.opendashboard.domain.ReportRunDtos.ReportArtifactCreateRequest;
import io.opendashboard.domain.ReportRunDtos.ReportArtifactVO;
import io.opendashboard.domain.ReportRunDtos.ReportClaimCreateRequest;
import io.opendashboard.domain.ReportRunDtos.ReportClaimVO;
import io.opendashboard.domain.ReportRunDtos.ReportEventCreateRequest;
import io.opendashboard.domain.ReportRunDtos.ReportEventVO;
import io.opendashboard.domain.ReportRunDtos.ReportEvidenceCreateRequest;
import io.opendashboard.domain.ReportRunDtos.ReportEvidenceVO;
import io.opendashboard.domain.ReportRunDtos.ReportRunVO;
import io.opendashboard.domain.ReportRunDtos.ReportTaskVO;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface ReportRunGateway {
    ReportRunVO create(String conversationId, String workspaceId, String ownerId,
                       Map<String, Object> brief, Map<String, Object> budget);
    Optional<ReportRunVO> find(String runId);
    Optional<ReportRunVO> findLatest(String conversationId, String workspaceId, String ownerId);
    Optional<ReportRunVO> updateRun(String runId, String status,
                                    Map<String, Object> brief, Integer briefVersion,
                                    Map<String, Object> plan, Integer planVersion,
                                    Integer approvedPlanVersion,
                                    Map<String, Object> quality, Integer activeArtifactVersion);
    List<ReportTaskVO> replaceTasks(String runId, int planVersion, List<Map<String, Object>> tasks);
    List<ReportTaskVO> listTasks(String runId);
    Optional<ReportTaskVO> findTask(String taskId);
    Optional<ReportTaskVO> updateTask(String taskId, String status, Integer attempt,
                                      Map<String, Object> spec, String skipReason);
    ReportEventVO appendEvent(String runId, ReportEventCreateRequest request);
    List<ReportEventVO> listEvents(String runId, Long afterId);
    ReportEvidenceVO appendEvidence(String runId, ReportEvidenceCreateRequest request);
    List<ReportEvidenceVO> listEvidence(String runId);
    ReportArtifactVO appendArtifact(String runId, ReportArtifactCreateRequest request);
    List<ReportArtifactVO> listArtifacts(String runId);
    List<ReportClaimVO> replaceClaims(String runId, List<ReportClaimCreateRequest> claims);
    List<ReportClaimVO> listClaims(String runId);
}
