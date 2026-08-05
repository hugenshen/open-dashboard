package io.opendashboard.adapter.web;

import io.opendashboard.application.CatalogService;
import io.opendashboard.domain.CatalogDtos.CatalogBundle;
import io.opendashboard.adapter.security.RequireAuth;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/catalog")
@RequireAuth
public class CatalogController {

    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping
    public CatalogBundle catalog() {
        return catalogService.catalog();
    }
}
