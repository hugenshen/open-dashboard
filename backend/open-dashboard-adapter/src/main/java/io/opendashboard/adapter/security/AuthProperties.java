package io.opendashboard.adapter.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "opendashboard.auth")
public class AuthProperties {

    /**
     * When no AuthProvider identity is found, use a demo principal so local/dev stays usable.
     * Set false in production so missing identity yields 401 on {@code @RequireAuth}.
     */
    private boolean devFallback = true;

    private String fallbackUserId = "demo";
    private String fallbackDisplayName = "演示用户";
    /** Comma-separated; {@code *} grants all. */
    private String fallbackPermissions = "*";

    public boolean isDevFallback() {
        return devFallback;
    }

    public void setDevFallback(boolean devFallback) {
        this.devFallback = devFallback;
    }

    public String getFallbackUserId() {
        return fallbackUserId;
    }

    public void setFallbackUserId(String fallbackUserId) {
        this.fallbackUserId = fallbackUserId;
    }

    public String getFallbackDisplayName() {
        return fallbackDisplayName;
    }

    public void setFallbackDisplayName(String fallbackDisplayName) {
        this.fallbackDisplayName = fallbackDisplayName;
    }

    public String getFallbackPermissions() {
        return fallbackPermissions;
    }

    public void setFallbackPermissions(String fallbackPermissions) {
        this.fallbackPermissions = fallbackPermissions;
    }
}
