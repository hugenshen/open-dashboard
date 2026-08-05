# 用户手册演示数据

与业务库隔离的 MySQL 演示库，用于手册截图与本地演示。

## 连接信息

| 项 | 值 |
|----|-----|
| Host | `127.0.0.1` |
| Port | `3306` |
| User | `root` |
| Password | `abc123` |
| Database | `od_manual_demo` |

## 场景表

| 表 | 用途 | 对齐模板数据集 |
|----|------|----------------|
| `fact_sales` | 销售分析（区域/渠道/产品/销售员） | `ds_sales` |
| `ops_daily` | 运营看板（UV/PV/端/模块） | `ds_ops` |
| `fact_finance` | 财务概览（科目/部门收支） | `ds_fin` |

## 重建步骤

```bash
# 1) 灌入 MySQL（务必带 utf8mb4，避免中文乱码）
mysql -h127.0.0.1 -uroot -pabc123 --default-character-set=utf8mb4 \
  < docs/user-manual/seed/od_manual_demo.sql

# 2) 在 Open Dashboard 中注册连接并绑定数据集 / 看板
#    需本地 API 已启动（默认 http://127.0.0.1:8082）
python3 docs/user-manual/seed/seed_manual_assets.py
```

若中文显示为乱码，可在库内执行（仅当 HEX 呈现双重 UTF-8 时）：

```sql
UPDATE fact_sales SET
  region = CONVERT(BINARY CONVERT(region USING latin1) USING utf8mb4),
  channel = CONVERT(BINARY CONVERT(channel USING latin1) USING utf8mb4),
  product = CONVERT(BINARY CONVERT(product USING latin1) USING utf8mb4),
  salesman = CONVERT(BINARY CONVERT(salesman USING latin1) USING utf8mb4);
-- ops_daily / fact_finance 同理
```
