package io.opendashboard.domain.datasource;

/** Runtime JDBC connection parameters (never returned to clients). */
public record ConnectionSpec(
        String type,
        String host,
        Integer port,
        String dbName,
        String schema,
        String username,
        String password
) {
    public String normalizedType() {
        if (type == null) return "postgresql";
        return switch (type.toLowerCase()) {
            case "pg", "postgres", "postgresql" -> "postgresql";
            case "mysql", "mariadb" -> "mysql";
            default -> type.toLowerCase();
        };
    }

    public boolean isJdbc() {
        String t = normalizedType();
        return "postgresql".equals(t) || "mysql".equals(t);
    }

    public ConnectionSpec withDbName(String db) {
        return new ConnectionSpec(type, host, port, db, schema, username, password);
    }

    public ConnectionSpec withSchema(String schemaName) {
        return new ConnectionSpec(type, host, port, dbName, schemaName, username, password);
    }
}
