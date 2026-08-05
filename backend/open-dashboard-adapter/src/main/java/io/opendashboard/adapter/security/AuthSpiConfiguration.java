package io.opendashboard.adapter.security;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Default SPI beans. Customers provide their own {@link AuthProvider} / {@link MenuProvider}
 * to replace these without Spring Security.
 */
@Configuration
@EnableConfigurationProperties(AuthProperties.class)
public class AuthSpiConfiguration {

    @Bean
    @ConditionalOnMissingBean(AuthProvider.class)
    public AuthProvider authProvider() {
        return new HeaderAuthProvider();
    }

    @Bean
    @ConditionalOnMissingBean(MenuProvider.class)
    public MenuProvider menuProvider() {
        return new DefaultMenuProvider();
    }
}
