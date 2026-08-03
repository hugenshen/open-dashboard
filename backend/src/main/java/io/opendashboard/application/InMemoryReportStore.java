package io.opendashboard.application;

import io.opendashboard.domain.ReportDtos.ReportCreateRequest;
import io.opendashboard.domain.ReportDtos.ReportDetailVO;
import io.opendashboard.domain.ReportDtos.ReportDocUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaVO;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class InMemoryReportStore {

    private final AtomicLong seq = new AtomicLong(1);
    private final ConcurrentHashMap<String, ReportDetailVO> reports = new ConcurrentHashMap<>();

    public InMemoryReportStore() {
        String id = "1";
        reports.put(id, new ReportDetailVO(
                new ReportMetaVO(id, "销售周报（报告脚手架）", "draft", "1", 1, System.currentTimeMillis()),
                emptyDoc()
        ));
    }

    public List<ReportMetaVO> list() {
        List<ReportMetaVO> out = new ArrayList<>();
        reports.values().forEach(d -> out.add(d.meta()));
        out.sort((a, b) -> a.id().compareTo(b.id()));
        return out;
    }

    public Optional<ReportDetailVO> get(String id) {
        return Optional.ofNullable(reports.get(id));
    }

    public ReportDetailVO create(ReportCreateRequest req) {
        String id = String.valueOf(seq.incrementAndGet());
        ReportDetailVO detail = new ReportDetailVO(
                new ReportMetaVO(
                        id,
                        req.name() == null || req.name().isBlank() ? "未命名报告" : req.name(),
                        "draft",
                        "1",
                        1,
                        System.currentTimeMillis()
                ),
                emptyDoc()
        );
        reports.put(id, detail);
        return detail;
    }

    public Optional<ReportDetailVO> updateDoc(String id, ReportDocUpdateRequest req) {
        ReportDetailVO cur = reports.get(id);
        if (cur == null) {
            return Optional.empty();
        }
        if (req.contentId() != null && !req.contentId().equals(cur.meta().contentId())) {
            throw new IllegalStateException("contentId conflict");
        }
        int nextContent = Integer.parseInt(cur.meta().contentId()) + 1;
        ReportMetaVO meta = new ReportMetaVO(
                cur.meta().id(),
                cur.meta().name(),
                cur.meta().status(),
                String.valueOf(nextContent),
                cur.meta().version(),
                System.currentTimeMillis()
        );
        ReportDetailVO next = new ReportDetailVO(meta, req.content() == null ? emptyDoc() : req.content());
        reports.put(id, next);
        return Optional.of(next);
    }

    public Optional<ReportDetailVO> publish(String id) {
        ReportDetailVO cur = reports.get(id);
        if (cur == null) {
            return Optional.empty();
        }
        ReportMetaVO meta = new ReportMetaVO(
                cur.meta().id(),
                cur.meta().name(),
                "published",
                cur.meta().contentId(),
                cur.meta().version() + 1,
                System.currentTimeMillis()
        );
        ReportDetailVO next = new ReportDetailVO(meta, cur.content());
        reports.put(id, next);
        return Optional.of(next);
    }

    private static Map<String, Object> emptyDoc() {
        Map<String, Object> text = new HashMap<>();
        text.put("type", "text");
        text.put("text", "在工具栏「插入」旁使用「引用看板图」或「新建图表」。");
        Map<String, Object> paragraph = new HashMap<>();
        paragraph.put("type", "paragraph");
        paragraph.put("content", List.of(text));
        Map<String, Object> doc = new HashMap<>();
        doc.put("type", "doc");
        doc.put("content", List.of(paragraph));
        return doc;
    }
}
