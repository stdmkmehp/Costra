# ADR-0001：采用多 Agent 协作 + 人工闸门的研发模式

- 状态：Accepted
- 日期：2026-04-20
- 决策者：Human (项目负责人)

## 背景
Costra 作为一个从 0 开始的 iOS + 后端 + 云基础设施全栈项目，单人或传统串行协作效率不足。
希望通过 6 个专业 Agent（PM / Design / iOS / Backend / DevOps / QA）并行协作完成从立项到上线的全流程，
同时保留"人"的观察和随时干预能力。

## 决策
1. 采用 Orchestrator + 6 Agent 的星型拓扑，Orchestrator 负责编排与闸门。
2. 所有协作产物落盘到 `.team/`，消息结构化（JSONL），工具调用可审计。
3. 设置 5 个人工闸门：G1 需求 / G2 设计 / G3 契约 / G4 合并 / G5 发布。
4. 干预通过 `.team/interventions/*.yaml` 结构化下达，禁止自由对话指令。
5. DevOps-Agent 运行于 `mode=default`，任何生产环境操作必须人工审批。

## 备选方案
- 单 Agent 串行：简单但慢，放弃。
- 纯对话式多 Agent：容易发散、无审计，放弃。

## 影响
- 需要统一 Schema 与目录约定（已落地）。
- 需要人每天 30 分钟运维看板（已写入 SOP）。
