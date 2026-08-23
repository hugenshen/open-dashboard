package io.opendashboard.infrastructure.datasource;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Protects the warehouse / JVM from runaway live queries:
 * <ul>
 *   <li>bounded concurrency (bulkhead)</li>
 *   <li>in-flight {@link Statement} registry so stop/timeout can {@code cancel()}</li>
 * </ul>
 */
@Component
public class LiveQueryGuard {

    private final Semaphore permits;
    private final long acquireWaitMs;
    private final Map<String, Handle> inflight = new ConcurrentHashMap<>();
    private final AtomicInteger cancelled = new AtomicInteger();

    public LiveQueryGuard(
            @Value("${opendashboard.query.max-concurrent:3}") int maxConcurrent,
            @Value("${opendashboard.query.acquire-wait-ms:2000}") long acquireWaitMs
    ) {
        int n = Math.max(1, maxConcurrent);
        this.permits = new Semaphore(n, true);
        this.acquireWaitMs = Math.max(0L, acquireWaitMs);
    }

    public record Handle(String id, String owner, Statement statement) {}

    /** Try to enter the bulkhead; throws when saturated. */
    public void acquire() {
        try {
            if (!permits.tryAcquire(acquireWaitMs, TimeUnit.MILLISECONDS)) {
                throw new IllegalStateException(
                        "查询繁忙：并发已达上限，请稍后重试或停止其他问数/看板查询"
                );
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("查询被中断", e);
        }
    }

    public void release() {
        permits.release();
    }

    public String register(String owner, Statement statement) {
        String id = UUID.randomUUID().toString();
        inflight.put(id, new Handle(id, owner == null ? "" : owner, statement));
        return id;
    }

    public void unregister(String id) {
        if (id != null) inflight.remove(id);
    }

    /** Cancel one statement (best-effort). */
    public boolean cancel(String id) {
        Handle h = inflight.get(id);
        if (h == null) return false;
        return cancelHandle(h);
    }

    /**
     * Cancel in-flight statements for an owner (userId). Empty owner cancels all.
     * @return number of cancel attempts that succeeded without throwing
     */
    public int cancelByOwner(String owner) {
        String key = owner == null ? "" : owner;
        List<Handle> targets = new ArrayList<>();
        for (Handle h : inflight.values()) {
            if (key.isBlank() || key.equals(h.owner())) targets.add(h);
        }
        int n = 0;
        for (Handle h : targets) {
            if (cancelHandle(h)) n++;
        }
        return n;
    }

    public int cancelAll() {
        return cancelByOwner("");
    }

    public Map<String, Object> snapshot() {
        return Map.of(
                "inflight", inflight.size(),
                "availablePermits", permits.availablePermits(),
                "cancelledTotal", cancelled.get()
        );
    }

    private boolean cancelHandle(Handle h) {
        try {
            Statement st = h.statement();
            if (st != null && !st.isClosed()) {
                st.cancel();
                cancelled.incrementAndGet();
                return true;
            }
        } catch (SQLException ignored) {
            // driver may already be tearing down
        } finally {
            inflight.remove(h.id());
        }
        return false;
    }
}
