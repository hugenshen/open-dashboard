package io.opendashboard.application;

import io.opendashboard.domain.DashboardDtos.DashboardDetailVO;
import io.opendashboard.domain.DashboardDtos.DashboardLayoutVO;
import io.opendashboard.domain.DashboardDtos.DashboardNodeVO;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class StubDashboardService {

    public Optional<DashboardDetailVO> findDetail(String id) {
        if (!"1".equals(id)) {
            return Optional.empty();
        }
        DashboardNodeVO meta = new DashboardNodeVO(
                "1", "0", "销售周报（脚手架）", "dashboard", "draft", "grid", "1", 1, 0L
        );
        DashboardLayoutVO layout = new DashboardLayoutVO(
                72,
                36,
                null,
                0,
                Map.of(),
                Map.of(
                        "enabled", true,
                        "device", "iphone-14",
                        "bg", "#f5f6f8",
                        "components", List.of()
                )
        );
        return Optional.of(new DashboardDetailVO(meta, layout, List.of(), Map.of(), List.of()));
    }
}
