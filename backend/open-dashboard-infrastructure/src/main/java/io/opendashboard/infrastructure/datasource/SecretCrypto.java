package io.opendashboard.infrastructure.datasource;

import org.springframework.beans.factory.annotation.Value;
import io.opendashboard.domain.gateway.SecretCipher;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/** AES-GCM encrypt/decrypt for datasource passwords stored in meta DB. */
@Component
public class SecretCrypto implements SecretCipher {

    private static final String PREFIX = "enc:v1:";
    private final byte[] keyBytes;

    public SecretCrypto(@Value("${opendashboard.datasource.crypto-key:opendashboard-local-ds-key}") String key) {
        this.keyBytes = sha256(key == null || key.isBlank() ? "opendashboard-local-ds-key" : key);
    }

    public String encrypt(String plain) {
        if (plain == null || plain.isEmpty()) return null;
        try {
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(keyBytes, "AES"), new GCMParameterSpec(128, iv));
            byte[] cipherText = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            ByteBuffer buf = ByteBuffer.allocate(iv.length + cipherText.length);
            buf.put(iv);
            buf.put(cipherText);
            return PREFIX + Base64.getEncoder().encodeToString(buf.array());
        } catch (Exception e) {
            throw new IllegalStateException("encrypt password failed", e);
        }
    }

    public String decrypt(String stored) {
        if (stored == null || stored.isBlank()) return "";
        if (!stored.startsWith(PREFIX)) {
            // legacy / plain local fallback
            return stored;
        }
        try {
            byte[] raw = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            ByteBuffer buf = ByteBuffer.wrap(raw);
            byte[] iv = new byte[12];
            buf.get(iv);
            byte[] cipherText = new byte[buf.remaining()];
            buf.get(cipherText);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(keyBytes, "AES"), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("decrypt password failed", e);
        }
    }

    private static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
