# Costra (cost + track)

> 家庭云端共享记账 **微信小程序** · 多 Agent 协作开发工程

Costra 是一款面向家庭的云端共享记账微信小程序，核心数据保存在云服务器，支持多人实时协作记账、微信生态原生分享与订阅消息推送。
本仓库不仅是产品代码仓，同时内置一套 **多 Agent 协作研发流水线**（PM / Design / MiniApp / Backend / DevOps / QA），
并配有完整的 **观察 + 干预** 机制，让"人"能够随时看见、随时叫停、随时纠偏。

> **v2.0 变更（2026-04-21）**：发布平台由 iOS 原生改为微信小程序。详见 [`.team/decisions/ADR-0003-platform-change-to-miniprogram.md`](./.team/decisions/ADR-0003-platform-change-to-miniprogram.md) 与 [`docs/PLATFORM-MIGRATION.md`](./docs/PLATFORM-MIGRATION.md)。

---

## 目录结构

```
Costra/
├── README.md                 ← 你正在读
├── COSTRA-BLUEPRINT.md       ← 【核心交付物】架构蓝图 + Agent 协作 + 观察干预说明
├── docs/                     ← 产品文档（PRD / ADR / 周报 / 复盘 / 平台迁移说明）
├── design/                   ← Design-Agent 产出（IA / 流程图 / 设计系统 / 标注，对齐 WeUI）
├── api/                      ← OpenAPI 契约（前后端共享事实源）
├── miniapp/                  ← MiniApp-Agent 代码仓（微信小程序原生 MINA + TypeScript）
├── server/                   ← Backend-Agent 代码仓（Go + MySQL + Redis）
├── infra/                    ← DevOps-Agent IaC（Terraform / K8s / CI/CD / miniprogram-ci）
├── qa/                       ← QA-Agent 测试用例 + 自动化脚本
└── .team/                    ← 多 Agent 协作中枢（Orchestrator 的工作区）
    ├── STATE                 ← 全局状态开关：RUNNING / PAUSED / ABORTED
    ├── board.md              ← 任务看板（Kanban）
    ├── backlog.json          ← 需求池
    ├── metrics.json          ← 关键指标（进度/覆盖率/缺陷）
    ├── risks.md              ← 风险登记册
    ├── agents/               ← 6 个 Agent + Orchestrator 的系统提示词
    ├── schemas/              ← 消息 / 任务 / 干预指令 JSON Schema
    ├── daily/                ← 每日站会纪要
    ├── messages/             ← 结构化消息流（JSONL）
    ├── tool_calls/           ← 工具调用审计（JSONL）
    ├── interventions/        ← 人工干预指令（YAML）
    ├── decisions/            ← ADR 架构决策记录
    ├── incidents/            ← 事故复盘
    └── dashboard.html        ← 本地可视化看板（浏览器直接打开）
```

## 快速开始

1. 阅读 [`COSTRA-BLUEPRINT.md`](./COSTRA-BLUEPRINT.md)，理解整体架构和协作模式。
2. 用浏览器打开 [`.team/dashboard.html`](./.team/dashboard.html) 查看实时看板。
3. 启动多 Agent 团队（见蓝图文档 §9 "启动与日常节奏"）。
4. 日常 30 分钟工作流见蓝图文档 §9.2。

## 许可

内部项目，未经授权禁止分发。

