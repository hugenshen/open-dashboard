package io.opendashboard.adapter.security;

import io.opendashboard.domain.context.AuthPrincipal;

import java.util.List;

/**
 * SPI: build navigation menus for the current principal.
 * Replace {@link DefaultMenuProvider} Bean to plug customer IAM menus.
 */
public interface MenuProvider {

    List<MenuItem> menus(AuthPrincipal principal);

    record MenuItem(String key, String label, String path) {}
}
