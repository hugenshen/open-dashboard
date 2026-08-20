package io.opendashboard.adapter.security;

import io.opendashboard.application.auth.IdentityService;
import io.opendashboard.application.conversation.ConversationProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Default SPI beans. Customers provide their own {@link AuthProvider} / {@link MenuProvider}
 * to replace these without Spring Security.
 */
@Configuration
@EnableConfigurationProperties({AuthProperties.class, ConversationProperties.class})
public class AuthSpiConfiguration {

    @Bean
    @ConditionalOnMissingBean(AuthProvider.class)
    public AuthProvider authProvider(
            IdentityService identityService,
            ConversationProperties conversationProperties,
            @Value("${opendashboard.auth.session-cookie-name:OD_SESSION}") String cookieName
    ) {
        return new SessionCookieAuthProvider(identityService, conversationProperties, cookieName);
    }

    @Bean
    @ConditionalOnMissingBean(MenuProvider.class)
    public MenuProvider menuProvider(ConversationProperties conversationProperties) {
        return new DefaultMenuProvider(conversationProperties);
    }
}
