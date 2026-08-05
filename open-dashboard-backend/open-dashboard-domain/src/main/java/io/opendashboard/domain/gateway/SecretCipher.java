package io.opendashboard.domain.gateway;

public interface SecretCipher {
    String encrypt(String plain);

    String decrypt(String stored);
}
