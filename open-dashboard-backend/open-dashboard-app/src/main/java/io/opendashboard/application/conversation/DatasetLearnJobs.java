package io.opendashboard.application.conversation;

import io.opendashboard.domain.context.AuthContext;
import io.opendashboard.domain.context.AuthPrincipal;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** In-memory learn jobs so the dataset page can show progress and cancel. */
@Component
public class DatasetLearnJobs {

    private final ConcurrentHashMap<String, Job> jobs = new ConcurrentHashMap<>();
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "dataset-learn-job");
        t.setDaemon(true);
        return t;
    });
    private final BiPlatformService bi;

    public DatasetLearnJobs(BiPlatformService bi) {
        this.bi = bi;
    }

    public Map<String, Object> start(String datasetId) {
        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        Job job = new Job(id, datasetId);
        jobs.put(id, job);
        AuthPrincipal principal = AuthContext.get();
        pool.submit(() -> {
            try {
                if (principal != null) AuthContext.set(principal);
                job.status = "running";
                Map<String, Object> result = bi.learnDataset(datasetId, () -> job.cancelled, phase -> job.phase = phase);
                if (job.cancelled || Boolean.TRUE.equals(result.get("cancelled"))) {
                    job.status = "cancelled";
                    job.phase = "cancelled";
                    job.result = result;
                    return;
                }
                job.result = result;
                job.status = Boolean.FALSE.equals(result.get("ok")) ? "error" : "done";
                job.phase = "done".equals(job.status) ? "done" : "error";
                if (result.get("error") != null) job.error = String.valueOf(result.get("error"));
            } catch (java.util.concurrent.CancellationException e) {
                job.status = "cancelled";
                job.phase = "cancelled";
            } catch (Exception e) {
                job.status = "error";
                job.phase = "error";
                job.error = e.getMessage();
            } finally {
                AuthContext.clear();
            }
        });
        return job.snapshot();
    }

    public Map<String, Object> snapshot(String jobId) {
        Job job = jobs.get(jobId);
        if (job == null) {
            Map<String, Object> miss = new LinkedHashMap<>();
            miss.put("ok", false);
            miss.put("error", "job not found");
            return miss;
        }
        return job.snapshot();
    }

    public Map<String, Object> cancel(String jobId) {
        Job job = jobs.get(jobId);
        if (job == null) {
            Map<String, Object> miss = new LinkedHashMap<>();
            miss.put("ok", false);
            miss.put("error", "job not found");
            return miss;
        }
        job.cancelled = true;
        if (!"done".equals(job.status) && !"error".equals(job.status)) {
            job.status = "cancelling";
        }
        return job.snapshot();
    }

    static final class Job {
        final String id;
        final String datasetId;
        volatile String status = "queued";
        volatile String phase = "queued";
        volatile String error;
        volatile boolean cancelled;
        volatile Map<String, Object> result;

        Job(String id, String datasetId) {
            this.id = id;
            this.datasetId = datasetId;
        }

        Map<String, Object> snapshot() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("jobId", id);
            out.put("datasetId", datasetId);
            out.put("status", status);
            out.put("phase", phase);
            out.put("phaseLabel", label(phase));
            if (error != null) out.put("error", error);
            if (result != null) out.put("result", result);
            return out;
        }

        private static String label(String phase) {
            return switch (phase == null ? "" : phase) {
                case "queued" -> "排队中";
                case "sample" -> "正在从表采样…";
                case "stats" -> "正在统计字段角色…";
                case "extract" -> "正在抽取指标与维度…";
                case "llm" -> "模型正在复核角色（可能需要几十秒）…";
                case "done" -> "完成";
                case "cancelling" -> "正在停止…";
                case "cancelled" -> "已停止";
                case "error" -> "学习失败";
                default -> phase;
            };
        }
    }
}
