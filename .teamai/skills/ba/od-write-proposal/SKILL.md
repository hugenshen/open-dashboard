---
name: od-write-proposal
description: 新建或改写 Open Dashboard 的 Pxxx 需求（范围、非目标、验收 criterion、高保入口）。不要写技术方案、不要改 OpenAPI、不要改产品代码。
---

# 写提案

规范：[process.md](../../../docs/process.md)。文档分层：[chat-is-not-source-of-truth.md](../../../learnings/chat-is-not-source-of-truth.md)。

## 何时新建

用户要的能力不在 `requirements.md`，且会改变交互、契约或模块边界。下一号见 `.teamai/docs/proposals/README.md`（当前下一号 `P017`）。**不要实现 P005（draft）。**

目录名 `Pxxx-name/` 建好后永不搬家。状态只改文首，并把该行写入 `roadmap/<状态>/README.md`。

## 必须有的文件

```text
Pxxx-name/
├── README.md                 # 文首 YAML + 开发入口骨架 + 范围/非目标 + 验收 ID 列表
├── req/                      # 可选：需求附录；没有就不建
└── test/
    └── acceptance.yaml       # BA 只写 criterion；status 留给测试
```

`design/`、OpenAPI、代码落点由 **开发** 在方案设计棒补，见 [od-solution-design](../../dev/od-solution-design/SKILL.md)。BA 不要编模块/接口/数据流。文首 `acceptance:` 指向 `test/acceptance.yaml`。

文首字段按 process 模板填。`gates` 四层分开：proposal / hi-fi / code / acceptance。

## README 写法

1. 第一段「开发入口」先写对照哪份高保、哪份 acceptance；**代码路径留给开发填**。
2. 写清给谁、要解决什么、**做 / 不做**（产品语言，不是类名）。
3. 「波及」表：依赖提案、回归哪些 `PR-*`、不要动什么。技术改动面由开发补。
4. 验收区只留 ID + 一句话标题，**禁止**复制 criterion / expected / status / evidence。
5. 一条在途提案建议 5～12 条阻塞项。

## acceptance.yaml

- BA 改 `criterion`；测试改 `status` / `evidence`；开发改 `command_or_path`（方案设计之后）
- 每条：稳定 ID、gate、可复现判据、方法、期望、证据、状态、是否阻塞 done
- `done` 之后 yaml 冻结

## 当轮回写

用户在对话里确认的范围、权限、交互、技术边界，**本轮结束前**写进本提案。后续决策推翻旧方案时，搜索并修正依赖提案，写明替代了什么。
