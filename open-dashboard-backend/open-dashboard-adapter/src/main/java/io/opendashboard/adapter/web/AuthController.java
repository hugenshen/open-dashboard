package io.opendashboard.adapter.web;

import io.opendashboard.application.WorkspaceGovernanceService;
import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.adapter.security.MenuProvider;
import io.opendashboard.domain.exception.UnauthorizedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequireAuth
@RequestMapping("/api/auth")
public class AuthController {

    private final MenuProvider menuProvider;
    private final WorkspaceGovernanceService workspaceGovernanceService;

    public AuthController(MenuProvider menuProvider, WorkspaceGovernanceService workspaceGovernanceService) {
        this.menuProvider = menuProvider;
        this.workspaceGovernanceService = workspaceGovernanceService;
    }

    @GetMapping("/me")
    public WorkspaceGovernanceService.AuthMeVO me() {
        AuthPrincipal p = AuthContext.get();
        if (p == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return workspaceGovernanceService.me(p);
    }

    @GetMapping("/menus")
    public List<MenuProvider.MenuItem> menus() {
        AuthPrincipal p = AuthContext.get();
        if (p == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return menuProvider.menus(p);
    }
}
