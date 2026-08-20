package io.opendashboard.adapter.web;

import io.opendashboard.adapter.security.RequireAuth;
import io.opendashboard.application.WorkspaceGovernanceService;
import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import io.opendashboard.domain.exception.UnauthorizedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequireAuth
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    private final WorkspaceGovernanceService service;

    public WorkspaceController(WorkspaceGovernanceService service) {
        this.service = service;
    }

    @GetMapping
    public List<WorkspaceGovernanceService.WorkspaceVO> workspaces() {
        AuthPrincipal principal = principal();
        return service.workspaces(principal, principal.workspaceId());
    }

    @GetMapping("/{workspaceId}/summary")
    public WorkspaceGovernanceService.WorkspaceSummaryVO summary(@PathVariable String workspaceId) {
        AuthPrincipal principal = principal();
        requireWorkspaceAdmin(principal);
        return service.summary(workspaceId, principal);
    }

    @GetMapping("/{workspaceId}/groups")
    public List<WorkspaceGovernanceService.WorkspaceGroupVO> groups(@PathVariable String workspaceId) {
        AuthPrincipal principal = principal();
        requireWorkspaceAdmin(principal);
        return service.groups(workspaceId, principal);
    }

    @GetMapping("/{workspaceId}/members")
    public List<WorkspaceGovernanceService.WorkspaceMemberVO> members(@PathVariable String workspaceId) {
        AuthPrincipal principal = principal();
        requireWorkspaceAdmin(principal);
        return service.members(workspaceId, principal);
    }

    @GetMapping("/{workspaceId}/roles")
    public List<WorkspaceGovernanceService.WorkspaceRoleVO> roles(@PathVariable String workspaceId) {
        AuthPrincipal principal = principal();
        requireWorkspaceAdmin(principal);
        return service.roles(workspaceId, principal);
    }

    @GetMapping("/{workspaceId}/effective-permissions")
    public WorkspaceGovernanceService.EffectivePermissionVO effectivePermissions(@PathVariable String workspaceId) {
        AuthPrincipal principal = principal();
        requireWorkspaceAdmin(principal);
        return service.effectivePermissions(workspaceId, principal);
    }

    @GetMapping("/{workspaceId}/data-plaza")
    public WorkspaceGovernanceService.DataPlazaVO dataPlaza(@PathVariable String workspaceId) {
        return service.dataPlaza(workspaceId, principal());
    }

    @PostMapping("/{workspaceId}/data-plaza/{assetId}/add")
    public WorkspaceGovernanceService.DataAssetVO addToMyData(
            @PathVariable String workspaceId,
            @PathVariable String assetId
    ) {
        return service.addToMyData(workspaceId, assetId, principal());
    }

    @PostMapping("/{workspaceId}/dataset-requests")
    public WorkspaceGovernanceService.DataRequestVO requestDataset(
            @PathVariable String workspaceId,
            @RequestBody WorkspaceGovernanceService.DataRequestCreateRequest request
    ) {
        return service.requestAccess(workspaceId, request, principal());
    }

    private static AuthPrincipal principal() {
        AuthPrincipal principal = AuthContext.get();
        if (principal == null) {
            throw new UnauthorizedException("Authentication required");
        }
        return principal;
    }

    private static void requireWorkspaceAdmin(AuthPrincipal principal) {
        if (principal.hasPermission("workspace:admin") || principal.hasPermission("workspace:manage_member")) {
            return;
        }
        throw new io.opendashboard.domain.exception.ForbiddenException("需要工作区管理权限");
    }
}
