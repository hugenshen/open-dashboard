package io.opendashboard.domain.exception;

/** No resource ACL. Mapped to HTTP 404 so existence is not leaked. */
public class ResourceForbiddenException extends RuntimeException {
    public ResourceForbiddenException(String message) {
        super(message);
    }
}
