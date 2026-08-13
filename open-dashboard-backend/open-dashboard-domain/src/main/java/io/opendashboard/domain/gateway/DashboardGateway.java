package io.opendashboard.domain.gateway;

import io.opendashboard.domain.CatalogDtos.DashboardCatalogItem;
import io.opendashboard.domain.DashboardDtos.BusiNodeVO;
import io.opendashboard.domain.DashboardDtos.ChartViewSaveRequest;
import io.opendashboard.domain.DashboardDtos.ChartViewVO;
import io.opendashboard.domain.DashboardDtos.DashboardBarVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentVO;
import io.opendashboard.domain.DashboardDtos.DashboardComponentsUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardCreateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutUpdateRequest;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutVO;
import io.opendashboard.domain.DashboardDtos.DashboardLinkageVO;
import io.opendashboard.domain.DashboardDtos.DashboardMoveRequest;
import io.opendashboard.domain.DashboardDtos.DashboardNodeVO;
import io.opendashboard.domain.DashboardDtos.DashboardRenameRequest;
import io.opendashboard.domain.DashboardDtos.DashboardShareVO;
import io.opendashboard.domain.DashboardDtos.DashboardStatusVO;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface DashboardGateway {

    Optional<DashboardDetailVO> findDetail(long id, String copyType);

    List<BusiNodeVO> tree();

    DashboardNodeVO create(DashboardCreateRequest req);

    Optional<DashboardNodeVO> rename(DashboardRenameRequest req);

    Optional<DashboardNodeVO> move(DashboardMoveRequest req);

    boolean delete(long id);

    Optional<DashboardBarVO> barInfo(long id);

    Optional<DashboardLayoutVO> updateLayout(long id, DashboardLayoutUpdateRequest req);

    List<DashboardLinkageVO> loadLinkages(long id, String copy);

    Optional<List<DashboardLinkageVO>> putLinkages(long id, List<DashboardLinkageVO> linkages);

    Optional<DashboardStatusVO> discardDraft(long id);

    Optional<DashboardShareVO> upsertShare(long dashboardId, String visibility, String perm);

    Optional<DashboardShareVO> findShare(long dashboardId);

    Optional<DashboardShareVO> findShareByToken(String token);

    Optional<List<DashboardComponentVO>> updateComponents(long id, DashboardComponentsUpdateRequest req);

    Optional<ChartViewVO> saveChart(long dashboardId, long chartId, ChartViewSaveRequest req);

    boolean deleteChart(long dashboardId, long chartId);

    Optional<DashboardStatusVO> publish(long id);

    Optional<DashboardStatusVO> status(long id);

    List<DashboardCatalogItem> listDashboardCatalog();

    Optional<Map<String, Object>> findChartEncode(String dashboardId, String chartId, String copyType);
}
