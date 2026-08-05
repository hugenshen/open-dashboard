FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
COPY open-dashboard-domain ./open-dashboard-domain
COPY open-dashboard-app ./open-dashboard-app
COPY open-dashboard-infrastructure ./open-dashboard-infrastructure
COPY open-dashboard-adapter ./open-dashboard-adapter
COPY open-dashboard-start ./open-dashboard-start
RUN mvn -q -DskipTests package -pl open-dashboard-start -am

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=build /app/open-dashboard-start/target/open-dashboard-start-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
