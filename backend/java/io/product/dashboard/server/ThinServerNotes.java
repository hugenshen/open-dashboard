package io.product.dashboard.server;

/**
 * Thin RestController sketch — copy into target Spring Boot module.
 *
 * {@code @RestController}
 * {@code @RequestMapping("/dashboardTree")}
 * class DashboardTreeServer implements DashboardTreeApi {
 *   {@code @Resource} DashboardTreeManage manage;
 *   // each method: return manage.xxx(...); no business logic here
 * }
 *
 * Same pattern for:
 * - DashboardCanvasServer  @RequestMapping("/dashboard")
 * - DashboardPublishServer @RequestMapping("/dashboard")
 * - ChartQueryServer       @RequestMapping("/chartQuery")
 *
 * Mirror DataEase DatasetTreeServer; do NOT grow into DataVisualizationServer size.
 */
public final class ThinServerNotes {
    private ThinServerNotes() {}
}
