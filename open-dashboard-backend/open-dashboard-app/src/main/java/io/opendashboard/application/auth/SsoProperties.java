package io.opendashboard.application.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@ConfigurationProperties(prefix = "opendashboard.auth.sso")
public class SsoProperties {

    private boolean enabled = true;
    private String stateCookieName = "OD_SSO_STATE";
    private long stateTtlSeconds = 600;
    private String defaultWorkspaceId = "workspace-retail";
    private String defaultRoleCode = "analyst";
    private Map<String, Provider> providers = new LinkedHashMap<>();

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getStateCookieName() {
        return stateCookieName;
    }

    public void setStateCookieName(String stateCookieName) {
        this.stateCookieName = stateCookieName;
    }

    public long getStateTtlSeconds() {
        return stateTtlSeconds;
    }

    public void setStateTtlSeconds(long stateTtlSeconds) {
        this.stateTtlSeconds = stateTtlSeconds;
    }

    public String getDefaultWorkspaceId() {
        return defaultWorkspaceId;
    }

    public void setDefaultWorkspaceId(String defaultWorkspaceId) {
        this.defaultWorkspaceId = defaultWorkspaceId;
    }

    public String getDefaultRoleCode() {
        return defaultRoleCode;
    }

    public void setDefaultRoleCode(String defaultRoleCode) {
        this.defaultRoleCode = defaultRoleCode;
    }

    public Map<String, Provider> getProviders() {
        return providers;
    }

    public void setProviders(Map<String, Provider> providers) {
        this.providers = providers == null ? new LinkedHashMap<>() : providers;
    }

    public Provider provider(String id) {
        Provider p = providers.get(id);
        if (p == null) return null;
        p.applyDefaults(id);
        return p;
    }

    public static class Provider {
        private boolean enabled = false;
        private String label;
        private String clientId;
        private String clientSecret;
        private String authorizationUri;
        private String tokenUri;
        private String userInfoUri;
        private String redirectUri;
        private List<String> scopes = List.of("openid", "email", "profile");

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getLabel() {
            return label;
        }

        public void setLabel(String label) {
            this.label = label;
        }

        public String getClientId() {
            return clientId;
        }

        public void setClientId(String clientId) {
            this.clientId = clientId;
        }

        public String getClientSecret() {
            return clientSecret;
        }

        public void setClientSecret(String clientSecret) {
            this.clientSecret = clientSecret;
        }

        public String getAuthorizationUri() {
            return authorizationUri;
        }

        public void setAuthorizationUri(String authorizationUri) {
            this.authorizationUri = authorizationUri;
        }

        public String getTokenUri() {
            return tokenUri;
        }

        public void setTokenUri(String tokenUri) {
            this.tokenUri = tokenUri;
        }

        public String getUserInfoUri() {
            return userInfoUri;
        }

        public void setUserInfoUri(String userInfoUri) {
            this.userInfoUri = userInfoUri;
        }

        public String getRedirectUri() {
            return redirectUri;
        }

        public void setRedirectUri(String redirectUri) {
            this.redirectUri = redirectUri;
        }

        public List<String> getScopes() {
            return scopes;
        }

        public void setScopes(List<String> scopes) {
            this.scopes = scopes == null || scopes.isEmpty() ? List.of("openid", "email", "profile") : scopes;
        }

        private void applyDefaults(String id) {
            if (label == null || label.isBlank()) label = "google".equals(id) ? "Google" : id;
            if ("google".equals(id)) {
                if (authorizationUri == null || authorizationUri.isBlank()) authorizationUri = "https://accounts.google.com/o/oauth2/v2/auth";
                if (tokenUri == null || tokenUri.isBlank()) tokenUri = "https://oauth2.googleapis.com/token";
                if (userInfoUri == null || userInfoUri.isBlank()) userInfoUri = "https://openidconnect.googleapis.com/v1/userinfo";
            }
        }
    }
}
