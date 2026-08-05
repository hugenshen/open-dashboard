package io.opendashboard.domain.context;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Current request identity. Customers map their SSO/JWT claims into this shape.
 */
public record AuthPrincipal(
        String userId,
        String displayName,
        Set<String> permissions
) {
    public AuthPrincipal {
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId required");
        }
        displayName = displayName == null || displayName.isBlank() ? userId : displayName;
        permissions = permissions == null
                ? Set.of()
                : Collections.unmodifiableSet(new LinkedHashSet<>(permissions));
    }

    public boolean hasPermission(String permission) {
        if (permission == null || permission.isBlank()) return true;
        if (permissions.contains("*") || permissions.contains(permission)) return true;
        // prefix wildcard: "dashboard:*" matches "dashboard:manage"
        int colon = permission.indexOf(':');
        if (colon > 0) {
            String wildcard = permission.substring(0, colon + 1) + "*";
            if (permissions.contains(wildcard)) return true;
        }
        return false;
    }
}
