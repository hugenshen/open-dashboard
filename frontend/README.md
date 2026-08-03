# Open Dashboard Frontend

Vue 3 · Vite · TypeScript · Pinia · Vue Router · ECharts

## 开发

```bash
# 终端 1：后端（stub 无需 PG）
cd backend && mvn spring-boot:run -Dspring-boot.run.arguments=--spring.profiles.active=stub

# 终端 2：前端
cd frontend && npm install && npm run dev
# → http://127.0.0.1:5173
```

`/api` 经 Vite 代理到 `http://127.0.0.1:8080`。

## 交互参照

完整编辑 / 移动端交互见仓库根目录：

```bash
npm run hi-fi
# → http://127.0.0.1:8765/dashboard-commercial.html
```

本应用当前为 **壳层脚手架**，不一次性搬运高保业务逻辑。

## 在线报告（v0.4）

```bash
# 后端 stub 已提供 /api/report 与 chartQuery inline
cd frontend && npm run dev
# → http://127.0.0.1:5173/reports
```

工具栏「插入」旁：**引用看板图** / **新建图表**（仅报告 inline，实时 `chartQuery`）。
