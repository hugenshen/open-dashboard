package io.opendashboard.application;

import io.opendashboard.domain.DatasetDtos.DatasetFieldVO;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Parse CSV / TSV / xlsx (first sheet) into a field bank + row grid.
 * Aligns with DataEase LOCALFILE: inspect headers, then query a landed table.
 */
public final class TabularFileParser {

    public static final int MAX_BYTES = 8 * 1024 * 1024;
    public static final int MAX_ROWS = 20_000;
    public static final int MAX_COLS = 40;

    private TabularFileParser() {}

    public record ParsedTable(List<DatasetFieldVO> fields, List<List<Object>> rows) {}

    public static ParsedTable parse(String filename, byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            throw new IllegalArgumentException("文件为空");
        }
        if (bytes.length > MAX_BYTES) {
            throw new IllegalArgumentException("文件超过 8MB");
        }
        String fn = filename == null ? "" : filename.toLowerCase(Locale.ROOT);
        if (fn.endsWith(".xls") && !fn.endsWith(".xlsx")) {
            throw new IllegalArgumentException("暂不支持 .xls，请另存为 .xlsx 或 .csv");
        }
        if (fn.endsWith(".xlsx") || isZip(bytes)) {
            return parseXlsx(bytes);
        }
        return parseCsv(bytes, sniffSep(bytes, fn));
    }

    private static boolean isZip(byte[] bytes) {
        return bytes.length >= 4 && bytes[0] == 'P' && bytes[1] == 'K';
    }

    private static char sniffSep(byte[] bytes, String fn) {
        if (fn.endsWith(".tsv")) return '\t';
        String head = new String(bytes, 0, Math.min(bytes.length, 4096), charsetOf(bytes));
        int comma = count(head, ',');
        int tab = count(head, '\t');
        int semi = count(head, ';');
        if (tab > comma && tab > semi) return '\t';
        if (semi > comma) return ';';
        return ',';
    }

    private static int count(String s, char c) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) == c) n++;
        return n;
    }

    private static Charset charsetOf(byte[] bytes) {
        if (bytes.length >= 3 && bytes[0] == (byte) 0xEF && bytes[1] == (byte) 0xBB && bytes[2] == (byte) 0xBF) {
            return StandardCharsets.UTF_8;
        }
        return StandardCharsets.UTF_8;
    }

    static ParsedTable parseCsv(byte[] bytes, char sep) {
        Charset cs = charsetOf(bytes);
        int offset = (bytes.length >= 3 && bytes[0] == (byte) 0xEF) ? 3 : 0;
        String text = new String(bytes, offset, bytes.length - offset, cs);
        List<List<String>> grid = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    cell.append(c);
                }
                continue;
            }
            if (c == '"') {
                quoted = true;
            } else if (c == sep) {
                row.add(cell.toString());
                cell.setLength(0);
            } else if (c == '\n') {
                row.add(cell.toString());
                cell.setLength(0);
                if (row.stream().anyMatch(s -> !s.isBlank())) grid.add(row);
                row = new ArrayList<>();
                if (grid.size() > MAX_ROWS) break;
            } else if (c != '\r') {
                cell.append(c);
            }
        }
        if (cell.length() > 0 || !row.isEmpty()) {
            row.add(cell.toString());
            if (row.stream().anyMatch(s -> !s.isBlank())) grid.add(row);
        }
        return fromGrid(grid);
    }

    private static ParsedTable fromGrid(List<List<String>> grid) {
        if (grid.isEmpty()) throw new IllegalArgumentException("没有可解析的表格行");
        List<String> header = grid.getFirst();
        int cols = Math.min(header.size(), MAX_COLS);
        if (cols == 0) throw new IllegalArgumentException("表头为空");
        List<String> labels = new ArrayList<>();
        for (int i = 0; i < cols; i++) {
            String h = header.get(i) == null ? "" : header.get(i).trim();
            labels.add(h.isBlank() ? ("列" + (i + 1)) : h);
        }
        List<String> names = uniqueIdents(labels);
        List<List<Object>> rows = new ArrayList<>();
        for (int r = 1; r < grid.size() && rows.size() < MAX_ROWS; r++) {
            List<String> raw = grid.get(r);
            List<Object> out = new ArrayList<>(cols);
            boolean any = false;
            for (int c = 0; c < cols; c++) {
                String v = c < raw.size() ? raw.get(c) : "";
                if (v != null) v = v.trim();
                if (v != null && !v.isBlank()) any = true;
                out.add(coerce(v));
            }
            if (any) rows.add(out);
        }
        if (rows.isEmpty()) throw new IllegalArgumentException("只有表头，没有数据行");
        List<DatasetFieldVO> fields = new ArrayList<>();
        for (int c = 0; c < cols; c++) {
            boolean numeric = mostlyNumeric(rows, c);
            fields.add(new DatasetFieldVO(
                    names.get(c),
                    labels.get(c),
                    numeric ? "quota" : "dim",
                    numeric ? "DECIMAL" : "STRING"
            ));
        }
        return new ParsedTable(fields, rows);
    }

    private static Object coerce(String v) {
        if (v == null || v.isBlank()) return "";
        String s = v.replace(",", "");
        try {
            if (s.matches("[-+]?\\d+")) return Long.parseLong(s);
            if (s.matches("[-+]?\\d*\\.\\d+([eE][-+]?\\d+)?")) return Double.parseDouble(s);
        } catch (NumberFormatException ignored) {
            return v;
        }
        return v;
    }

    private static boolean mostlyNumeric(List<List<Object>> rows, int col) {
        int n = 0;
        int num = 0;
        for (List<Object> row : rows) {
            if (col >= row.size()) continue;
            Object v = row.get(col);
            if (v == null || String.valueOf(v).isBlank()) continue;
            n++;
            if (v instanceof Number) num++;
        }
        return n > 0 && num * 10 >= n * 8;
    }

    static List<String> uniqueIdents(List<String> labels) {
        Map<String, Integer> seen = new LinkedHashMap<>();
        List<String> out = new ArrayList<>();
        for (int i = 0; i < labels.size(); i++) {
            String ident = ident(labels.get(i), i);
            int n = seen.getOrDefault(ident, 0) + 1;
            seen.put(ident, n);
            out.add(n == 1 ? ident : ident + "_" + n);
        }
        return out;
    }

    static String ident(String header, int i) {
        StringBuilder sb = new StringBuilder();
        for (int k = 0; k < header.length(); k++) {
            char c = header.charAt(k);
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
                sb.append(c);
            } else if (c == ' ' || c == '-' || c == '.') {
                sb.append('_');
            }
        }
        String s = sb.toString().toLowerCase(Locale.ROOT);
        while (s.contains("__")) s = s.replace("__", "_");
        s = s.replaceAll("^_+|_+$", "");
        if (s.isEmpty() || Character.isDigit(s.charAt(0))) {
            s = "f" + (i + 1) + (s.isEmpty() ? "" : "_" + s);
        }
        if (s.length() > 48) s = s.substring(0, 48);
        return s;
    }

    static ParsedTable parseXlsx(byte[] bytes) {
        Map<String, byte[]> parts = unzip(bytes);
        List<String> shared = parseSharedStrings(parts.get("xl/sharedStrings.xml"));
        byte[] sheet = parts.get("xl/worksheets/sheet1.xml");
        if (sheet == null) {
            for (String k : parts.keySet()) {
                if (k.startsWith("xl/worksheets/sheet") && k.endsWith(".xml")) {
                    sheet = parts.get(k);
                    break;
                }
            }
        }
        if (sheet == null) throw new IllegalArgumentException("xlsx 中没有工作表");
        List<List<String>> grid = parseSheet(sheet, shared);
        return fromGrid(grid);
    }

    private static Map<String, byte[]> unzip(byte[] bytes) {
        Map<String, byte[]> out = new HashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                zis.transferTo(bos);
                out.put(e.getName(), bos.toByteArray());
            }
        } catch (Exception ex) {
            throw new IllegalArgumentException("无法读取 xlsx: " + ex.getMessage());
        }
        return out;
    }

    private static XMLInputFactory xmlFactory() {
        XMLInputFactory f = XMLInputFactory.newFactory();
        f.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        f.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
        return f;
    }

    private static List<String> parseSharedStrings(byte[] xml) {
        List<String> out = new ArrayList<>();
        if (xml == null) return out;
        try (InputStream in = new ByteArrayInputStream(xml)) {
            XMLStreamReader r = xmlFactory().createXMLStreamReader(in);
            StringBuilder t = new StringBuilder();
            boolean inSi = false;
            boolean inT = false;
            while (r.hasNext()) {
                int ev = r.next();
                if (ev == XMLStreamConstants.START_ELEMENT) {
                    String n = r.getLocalName();
                    if ("si".equals(n)) {
                        inSi = true;
                        t.setLength(0);
                    } else if (inSi && "t".equals(n)) {
                        inT = true;
                    }
                } else if (ev == XMLStreamConstants.CHARACTERS && inT) {
                    t.append(r.getText());
                } else if (ev == XMLStreamConstants.END_ELEMENT) {
                    String n = r.getLocalName();
                    if ("t".equals(n)) inT = false;
                    if ("si".equals(n)) {
                        out.add(t.toString());
                        inSi = false;
                    }
                }
            }
            r.close();
        } catch (Exception ex) {
            throw new IllegalArgumentException("xlsx 共享字符串解析失败");
        }
        return out;
    }

    private static List<List<String>> parseSheet(byte[] xml, List<String> shared) {
        List<List<String>> grid = new ArrayList<>();
        try (InputStream in = new ByteArrayInputStream(xml)) {
            XMLStreamReader r = xmlFactory().createXMLStreamReader(in);
            Map<Integer, String> current = new HashMap<>();
            int maxCol = -1;
            String cellRef = "";
            String cellType = "";
            StringBuilder text = new StringBuilder();
            boolean inV = false;
            boolean inIs = false;
            boolean inT = false;
            while (r.hasNext()) {
                int ev = r.next();
                if (ev == XMLStreamConstants.START_ELEMENT) {
                    String n = r.getLocalName();
                    if ("row".equals(n)) {
                        current = new HashMap<>();
                        maxCol = -1;
                    } else if ("c".equals(n)) {
                        cellRef = attr(r, "r");
                        cellType = attr(r, "t");
                        text.setLength(0);
                    } else if ("v".equals(n)) {
                        inV = true;
                    } else if ("is".equals(n)) {
                        inIs = true;
                    } else if (inIs && "t".equals(n)) {
                        inT = true;
                    }
                } else if (ev == XMLStreamConstants.CHARACTERS) {
                    if (inV || inT) text.append(r.getText());
                } else if (ev == XMLStreamConstants.END_ELEMENT) {
                    String n = r.getLocalName();
                    if ("v".equals(n)) inV = false;
                    if ("t".equals(n)) inT = false;
                    if ("is".equals(n)) inIs = false;
                    if ("c".equals(n)) {
                        int col = colIndex(cellRef);
                        if (col >= 0 && col < MAX_COLS) {
                            current.put(col, cellValue(cellType, text.toString(), shared));
                            if (col > maxCol) maxCol = col;
                        }
                    } else if ("row".equals(n)) {
                        if (maxCol >= 0 && grid.size() < MAX_ROWS + 1) {
                            List<String> row = new ArrayList<>();
                            for (int i = 0; i <= Math.min(maxCol, MAX_COLS - 1); i++) {
                                row.add(current.getOrDefault(i, ""));
                            }
                            if (row.stream().anyMatch(s -> s != null && !s.isBlank())) grid.add(row);
                        }
                    }
                }
            }
            r.close();
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception ex) {
            throw new IllegalArgumentException("xlsx 工作表解析失败");
        }
        return grid;
    }

    private static String attr(XMLStreamReader r, String name) {
        String v = r.getAttributeValue(null, name);
        if (v != null) return v;
        for (int i = 0; i < r.getAttributeCount(); i++) {
            if (name.equals(r.getAttributeLocalName(i))) return r.getAttributeValue(i);
        }
        return "";
    }

    private static String cellValue(String type, String raw, List<String> shared) {
        if ("s".equals(type)) {
            try {
                int idx = Integer.parseInt(raw.trim());
                if (idx >= 0 && idx < shared.size()) return shared.get(idx);
            } catch (NumberFormatException ignored) {
                return raw;
            }
        }
        if ("inlineStr".equals(type) || "str".equals(type)) return raw;
        return raw;
    }

    static int colIndex(String ref) {
        if (ref == null || ref.isBlank()) return -1;
        int n = 0;
        for (int i = 0; i < ref.length(); i++) {
            char c = ref.charAt(i);
            if (c >= 'A' && c <= 'Z') n = n * 26 + (c - 'A' + 1);
            else if (c >= 'a' && c <= 'z') n = n * 26 + (c - 'a' + 1);
            else break;
        }
        return n - 1;
    }
}
