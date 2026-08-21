package io.opendashboard.application.auth;

import io.opendashboard.domain.gateway.IdentityRepository;

public interface PasswordHasher {

    IdentityRepository.PasswordHash hash(String password);

    boolean verify(String password, IdentityRepository.PasswordHash stored);
}
