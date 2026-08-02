# 仪表盘商用高保原型 · 本地预览

纯静态页面，**不依赖后端**。图表库已放在 `vendor/echarts.min.js`，可离线打开。

## 你现在是怎么访问的

在项目里执行：

```bash
cd dashboard-redesign
npm run hi-fi
# 等价于：python3 -m http.server 8765 --directory frontend/hi-fi
```

浏览器打开：

[http://127.0.0.1:8765/dashboard-commercial.html](http://127.0.0.1:8765/dashboard-commercial.html)

不要用 `file://` 直接双击 HTML（部分浏览器会拦模块/路径）。

## 打包发给别人

把整个 `hi-fi` 文件夹打成 zip 即可（约含本说明、`dashboard-commercial.html`、`vendor/`）。

对方解压后：

**macOS / Linux**

```bash
cd hi-fi          # 或解压出来的文件夹名
./start.sh
```

浏览器打开提示的地址。

**Windows**

双击 `start.bat`，再打开提示的地址。

或任意目录执行：

```bash
python3 -m http.server 8765
# Windows 也可能是：py -m http.server 8765
```

然后访问 `http://127.0.0.1:8765/dashboard-commercial.html`。

## 包含文件

| 文件 | 说明 |
|------|------|
| `dashboard-commercial.html` | 主原型（编辑 / 预览 / 字段银行 / 透视表等） |
| `dashboard-feishu.html` | 较早的飞书风列表原型（可选） |
| `vendor/echarts.min.js` | ECharts 5.5.1，本地离线 |
| `start.sh` / `start.bat` | 一键起本地静态服务 |

## 说明

- 数据与状态均在浏览器内存中，刷新会恢复演示默认看板。
- 这是高保真交互原型，不是已部署的生产系统。
