package io.opendashboard.application;

import io.opendashboard.domain.ReportDtos.ReportCreateRequest;
import io.opendashboard.domain.ReportDtos.ReportDetailVO;
import io.opendashboard.domain.ReportDtos.ReportDocUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaUpdateRequest;
import io.opendashboard.domain.ReportDtos.ReportMetaVO;
import io.opendashboard.domain.gateway.ReportGateway;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Service
@Profile("stub")
public class InMemoryReportStore implements ReportGateway {

    private final AtomicLong seq = new AtomicLong(1);
    private final ConcurrentHashMap<String, ReportDetailVO> reports = new ConcurrentHashMap<>();

    public InMemoryReportStore() {
        String id = "1";
        reports.put(id, new ReportDetailVO(
                new ReportMetaVO(id, "销售周报（报告脚手架）", "draft", "1", 1, System.currentTimeMillis()),
                emptyDoc()
        ));
    }

    @Override
    public List<ReportMetaVO> list(Integer limit) {
        List<ReportMetaVO> out = new ArrayList<>();
        reports.values().forEach(d -> out.add(d.meta()));
        out.sort((a, b) -> Long.compare(
                b.updateTime() == null ? 0L : b.updateTime(),
                a.updateTime() == null ? 0L : a.updateTime()
        ));
        if (limit == null || limit <= 0 || out.size() <= limit) return out;
        return out.subList(0, Math.min(limit, 50));
    }

    @Override
    public Optional<ReportDetailVO> get(String id) {
        return Optional.ofNullable(reports.get(id));
    }

    @Override
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

    @Override
    public Optional<ReportMetaVO> updateMeta(String id, ReportMetaUpdateRequest req) {
        ReportDetailVO cur = reports.get(id);
        if (cur == null) {
            return Optional.empty();
        }
        String name = req.name() == null || req.name().isBlank() ? cur.meta().name() : req.name().trim();
        ReportMetaVO meta = new ReportMetaVO(
                cur.meta().id(),
                name,
                cur.meta().status(),
                cur.meta().contentId(),
                cur.meta().version(),
                System.currentTimeMillis()
        );
        reports.put(id, new ReportDetailVO(meta, cur.content()));
        return Optional.of(meta);
    }

    @Override
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

    @Override
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
        text.put("text", "在 Ribbon「工具」中使用「引用仪表盘」或「新建图表」插入实时图表。");
        Map<String, Object> paragraph = new HashMap<>();
        paragraph.put("type", "paragraph");
        paragraph.put("content", List.of(text));
        Map<String, Object> doc = new HashMap<>();
        doc.put("type", "doc");
        doc.put("content", List.of(paragraph));
        return doc;
    }
}
