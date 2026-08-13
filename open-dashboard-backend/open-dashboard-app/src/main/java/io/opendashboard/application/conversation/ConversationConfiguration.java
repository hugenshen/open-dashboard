package io.opendashboard.application.conversation;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(ConversationProperties.class)
public class ConversationConfiguration {
}
