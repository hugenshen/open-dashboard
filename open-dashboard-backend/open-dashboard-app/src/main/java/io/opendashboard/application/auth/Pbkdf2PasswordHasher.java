package io.opendashboard.application.auth;

import io.opendashboard.domain.gateway.IdentityRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

@Component
public class Pbkdf2PasswordHasher implements PasswordHasher {

    public static final String ALGORITHM = "PBKDF2WithHmacSHA256";

    private final SecureRandom random = new SecureRandom();
    private final int passwordIterations;
    private final int keyLengthBits;

    public Pbkdf2PasswordHasher(
            @Value("${opendashboard.auth.password-iterations:600000}") int passwordIterations,
            @Value("${opendashboard.auth.password-key-length-bits:256}") int keyLengthBits
    ) {
        this.passwordIterations = passwordIterations;
        this.keyLengthBits = keyLengthBits;
    }

    @Override
    public IdentityRepository.PasswordHash hash(String password) {
        validatePassword(password);
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        int iterations = Math.max(120_000, passwordIterations);
        byte[] out = pbkdf2(password.toCharArray(), salt, iterations);
        return new IdentityRepository.PasswordHash(
                ALGORITHM,
                iterations,
                Base64.getEncoder().encodeToString(salt),
                Base64.getEncoder().encodeToString(out)
        );
    }

    @Override
    public boolean verify(String password, IdentityRepository.PasswordHash stored) {
        if (password == null || stored == null || stored.salt() == null || stored.hash() == null) return false;
        if (!ALGORITHM.equals(stored.algorithm())) return false;
        byte[] salt = Base64.getDecoder().decode(stored.salt());
        byte[] expected = Base64.getDecoder().decode(stored.hash());
        byte[] actual = pbkdf2(password.toCharArray(), salt, stored.iterations());
        return MessageDigest.isEqual(expected, actual);
    }

    private byte[] pbkdf2(char[] password, byte[] salt, int iterations) {
        try {
            PBEKeySpec spec = new PBEKeySpec(
                    password,
                    salt,
                    iterations,
                    Math.max(256, keyLengthBits)
            );
            return SecretKeyFactory.getInstance(ALGORITHM).generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException("Password hashing failed", e);
        }
    }

    private void validatePassword(String password) {
        if (password == null || password.length() < 8) {
            throw new IllegalArgumentException("密码至少 8 位");
        }
        if (password.length() > 128) {
            throw new IllegalArgumentException("密码过长");
        }
    }
}
