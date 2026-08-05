package io.opendashboard.domain.gateway;

import io.opendashboard.domain.CatalogDtos.DatasetCatalogItem;
import io.opendashboard.domain.DatasetDtos.DatasetCreateRequest;
import io.opendashboard.domain.DatasetDtos.DatasetDetailVO;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.DatasetDtos.DatasetMetaVO;
import io.opendashboard.domain.DatasetDtos.DatasetUpdateRequest;

import java.util.List;
import java.util.Optional;

public interface DatasetGateway {

    List<DatasetMetaVO> list();

    Optional<DatasetDetailVO> find(String id);

    DatasetDetailVO create(DatasetCreateRequest req);

    Optional<DatasetDetailVO> update(String id, DatasetUpdateRequest req);

    Optional<DatasetDetailVO> replaceFields(String id, List<DatasetFieldVO> fields);

    boolean delete(String id);

    List<DatasetCatalogItem> listCatalog();
}
