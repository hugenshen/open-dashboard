package io.opendashboard.adapter.web;

import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.adapter.security.MenuProvider;
import io.opendashboard.domain.exception.UnauthorizedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final MenuProvider menuProvider;

    public AuthController(MenuProvider menuProvider) {
        this.menuProvider = menuProvider;
    }

    @GetMapping("/me")
    public Map<String, Object> me() {
        AuthPrincipal p = AuthContext.get();
        if (p == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return Map.of(
                "userId", p.userId(),
                "displayName", p.displayName(),
                "permissions", p.permissions()
        );
    }

    @GetMapping("/menus")
    public List<MenuProvider.MenuItem> menus() {
        AuthPrincipal p = AuthContext.get();
        if (p == null) {
            // still allow menus via empty principal when interceptor did not set one
            p = new AuthPrincipal("anonymous", "anonymous", Set.of());
        }
        return menuProvider.menus(p);
    }
}
