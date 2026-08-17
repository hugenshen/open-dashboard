package io.opendashboard.application;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;
import io.opendashboard.domain.QueryDtos.ColumnMeta;
import io.opendashboard.domain.QueryDtos.DatasetQueryRequest;
import io.opendashboard.domain.QueryDtos.DatasetQueryResult;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Landed file tables for Ask-data (DataEase LOCALFILE analogue).
 * Rows live beside the dataset id so chartQuery / SQLBot can read them without JDBC.
 */
@Component
public class FileTableStore {

    private final ObjectMapper mapper;
    private final Path dir;
    private final ConcurrentHashMap<String, Table> tables = new ConcurrentHashMap<>();

    public FileTableStore(@Value("${opendashboard.file-import.dir:}") String dir) {
        this.mapper = new ObjectMapper();
        if (dir != null && !dir.isBlank()) {
            this.dir = Path.of(dir);
        } else {
            this.dir = Path.of(System.getProperty("user.home"), ".opendashboard", "file-datasets");
        }
    }

    public record Table(
            String datasetId,
            String tableName,
            List<DatasetFieldVO> fields,
            List<List<Object>> rows
    ) {}

    @PostConstruct
    public void load() {
        try {
            Files.createDirectories(dir);
            try (var stream = Files.list(dir)) {
                stream.filter(p -> p.getFileName().toString().endsWith(".json")).forEach(p -> {
                    try {
                        Table t = mapper.readValue(p.toFile(), new TypeReference<Table>() {});
                        if (t != null && t.datasetId() != null) tables.put(t.datasetId(), t);
                    } catch (Exception ignored) {
                        // skip corrupt sidecar
                    }
                });
            }
        } catch (Exception ignored) {
            // directory may be unwritable in some profiles
        }
    }

    public boolean has(String datasetId) {
        return datasetId != null && tables.containsKey(datasetId);
    }

    public Table get(String datasetId) {
        return datasetId == null ? null : tables.get(datasetId);
    }

    public void put(String datasetId, String tableName, TabularFileParser.ParsedTable parsed) {
        Table t = new Table(
                datasetId,
                tableName,
                parsed.fields() == null ? List.of() : parsed.fields(),
                parsed.rows() == null ? List.of() : parsed.rows()
        );
        tables.put(datasetId, t);
        try {
            Files.createDirectories(dir);
            mapper.writerWithDefaultPrettyPrinter().writeValue(dir.resolve(datasetId + ".json").toFile(), t);
        } catch (Exception ignored) {
            // memory still holds the table for this process
        }
    }

    public void remove(String datasetId) {
        if (datasetId == null) return;
        tables.remove(datasetId);
        try {
            Files.deleteIfExists(dir.resolve(datasetId + ".json"));
        } catch (Exception ignored) {
            // ignore
        }
    }

    public DatasetQueryResult query(DatasetQueryRequest request) {
        if (request == null || request.datasetId() == null) return null;
        Table t = tables.get(request.datasetId());
        if (t == null) return null;
        long start = System.currentTimeMillis();
        int limit = request.limit() == null || request.limit() <= 0 ? 500 : Math.min(request.limit(), 5000);
        List<List<Object>> source = FilterAst.filterTableRows(t.fields(), t.rows(), request.filters());
        String dim = firstField(request.dimensions());
        String measure = firstField(request.measures());
        String agg = firstAgg(request.measures());
        if (dim == null && measure == null) {
            return scan(t, source, limit, start);
        }
        int dimIdx = indexOf(t, dim);
        int meaIdx = indexOf(t, measure);
        if (measure != null && meaIdx < 0) {
            return empty(t, "-- file table: measure not found " + measure, start);
        }
        if (dim == null || dimIdx < 0) {
            double v = aggregate(columnNums(source, meaIdx), agg);
            return new DatasetQueryResult(
                    List.of(new ColumnMeta(measure == null ? "value" : measure, "DECIMAL", measure, agg)),
                    List.of(List.of(v)),
                    false,
                    "-- file scan agg " + agg + "(" + measure + ")",
                    System.currentTimeMillis() - start
            );
        }
        Map<String, List<Number>> groups = new LinkedHashMap<>();
        for (List<Object> row : source) {
            Object key = dimIdx < row.size() ? row.get(dimIdx) : "";
            String k = key == null ? "" : String.valueOf(key);
            Number n = meaIdx >= 0 && meaIdx < row.size() ? toNumber(row.get(meaIdx)) : 1;
            groups.computeIfAbsent(k, x -> new ArrayList<>()).add(n);
        }
        List<List<Object>> out = new ArrayList<>();
        int i = 0;
        for (Map.Entry<String, List<Number>> e : groups.entrySet()) {
            if (i++ >= limit) break;
            out.add(List.of(e.getKey(), aggregate(e.getValue(), agg)));
        }
        return new DatasetQueryResult(
                List.of(
                        new ColumnMeta(dim, "STRING", dim, null),
                        new ColumnMeta(measure == null ? "value" : measure, "DECIMAL", measure, agg)
                ),
                out,
                groups.size() > limit,
                "-- file group by " + dim,
                System.currentTimeMillis() - start
        );
    }

    public DatasetQueryResult scan(String datasetId, Integer limit) {
        Table t = tables.get(datasetId);
        if (t == null) return null;
        int lim = limit == null || limit <= 0 ? 500 : Math.min(limit, 5000);
        return scan(t, t.rows(), lim, System.currentTimeMillis());
    }

    private DatasetQueryResult scan(Table t, List<List<Object>> source, int limit, long start) {
        List<ColumnMeta> cols = new ArrayList<>();
        for (DatasetFieldVO f : t.fields()) {
            cols.add(new ColumnMeta(f.name(), f.dataType(), f.name(), null));
        }
        List<List<Object>> rows = source.size() > limit ? source.subList(0, limit) : source;
        return new DatasetQueryResult(
                cols,
                new ArrayList<>(rows),
                source.size() > limit,
                "SELECT * FROM " + t.tableName() + " LIMIT " + limit,
                System.currentTimeMillis() - start
        );
    }

    private static DatasetQueryResult empty(Table t, String sql, long start) {
        return new DatasetQueryResult(List.of(), List.of(), false, sql, System.currentTimeMillis() - start);
    }

    private static int indexOf(Table t, String name) {
        if (name == null) return -1;
        for (int i = 0; i < t.fields().size(); i++) {
            DatasetFieldVO f = t.fields().get(i);
            if (name.equalsIgnoreCase(f.name()) || name.equals(f.label())) return i;
        }
        return -1;
    }

    private static String firstField(List<Map<String, Object>> specs) {
        if (specs == null) return null;
        for (Map<String, Object> m : specs) {
            if (m == null) continue;
            Object f = m.get("field");
            if (f != null && !String.valueOf(f).isBlank()) return String.valueOf(f);
        }
        return null;
    }

    private static String firstAgg(List<Map<String, Object>> specs) {
        if (specs == null) return "SUM";
        for (Map<String, Object> m : specs) {
            if (m != null && m.get("agg") != null) return String.valueOf(m.get("agg"));
        }
        return "SUM";
    }

    private static List<Number> columnNums(List<List<Object>> rows, int idx) {
        List<Number> out = new ArrayList<>();
        if (idx < 0 || rows == null) return out;
        for (List<Object> row : rows) {
            if (idx < row.size()) out.add(toNumber(row.get(idx)));
        }
        return out;
    }

    private static Number toNumber(Object raw) {
        if (raw instanceof Number n) return n;
        if (raw == null) return 0;
        try {
            return Double.parseDouble(String.valueOf(raw).replace(",", ""));
        } catch (Exception e) {
            return 0;
        }
    }

    private static double aggregate(List<Number> data, String agg) {
        if (data == null || data.isEmpty()) return 0;
        double sum = data.stream().mapToDouble(Number::doubleValue).sum();
        if ("AVG".equalsIgnoreCase(agg) || "AVERAGE".equalsIgnoreCase(agg)) return sum / data.size();
        if ("COUNT".equalsIgnoreCase(agg)) return data.size();
        if ("MAX".equalsIgnoreCase(agg)) return data.stream().mapToDouble(Number::doubleValue).max().orElse(0);
        if ("MIN".equalsIgnoreCase(agg)) return data.stream().mapToDouble(Number::doubleValue).min().orElse(0);
        return sum;
    }
}
