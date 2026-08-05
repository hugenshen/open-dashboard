package io.opendashboard.domain.gateway;

import io.opendashboard.domain.DatasourceDtos.DatasourceCreateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceUpdateRequest;
import io.opendashboard.domain.DatasourceDtos.DatasourceVO;

import java.util.List;
import java.util.Optional;

public interface DatasourceGateway {

    record StoredDatasource(DatasourceVO vo, String passwordEnc) {}

    List<DatasourceVO> list();

    Optional<DatasourceVO> find(String id);

    Optional<StoredDatasource> findStored(String id);

    DatasourceVO create(DatasourceCreateRequest req, String passwordEnc);

    Optional<DatasourceVO> update(String id, DatasourceUpdateRequest req, String passwordEncOrNull);

    void updateStatus(String id, String status);

    boolean delete(String id);
}
