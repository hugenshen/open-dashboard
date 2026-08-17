package io.opendashboard.domain.gateway;

import io.opendashboard.domain.ReportDtos.ReportCreateRequest;
import io.opendashboard.domain.ReportDtos.ReportDetailVO;
import io.opendashboard.domain.ReportDtos.ReportDocUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaVO;

import java.util.List;
import java.util.Optional;

public interface ReportGateway {

    List<ReportMetaVO> list(Integer limit);

    Optional<ReportDetailVO> get(String id);

    ReportDetailVO create(ReportCreateRequest request);

    Optional<ReportMetaVO> updateMeta(String id, ReportMetaUpdateRequest request);

    Optional<ReportDetailVO> updateDoc(String id, ReportDocUpdateRequest request);

    Optional<ReportDetailVO> publish(String id);
}
