# Follow-ups · Review 延后项登记

> 登记规则：Review-Agent 判为 P2（不阻断当卡）且被审 Agent 采纳"延后到后续 Sprint 处理"的条目集中登记于此，供 Sprint Planning 会议扫描认领。
>
> **维护人**：Orchestrator（在 `{Agent}-Revision-Response` 产出时同步写入本索引）
> **消费方**：PM-Agent（Sprint Planning 扫描 → 纳入新卡或并入相关卡）
>
> **状态字段**：
> - `open` — 待 Sprint 认领
> - `scoped` — 已认领到某卡/某 Sprint（填 `owner_card`）
> - `closed` — 已完成（填 `resolved_by` commit / 卡号）

---

## 登记列表

### FU-001 · 业务占位昵称配置化

- **来源**：`.team/reviews/COSTRA-101/round-1-tech.md` P2-1
- **登记时间**：2026-04-24 11:50（COSTRA-101 Round 1 Revise）
- **范围**：`server/src/services/authService.ts` wxLogin 路径里的硬编码 `nickname: '微信用户'`
- **建议**：抽到 `server/src/config/defaults.ts` 导出 `defaultNickname`，支持 env 覆盖 + subjectConfig 语境化
- **阻断级别**：P2（不阻当卡 · 登录链路业务可用）
- **认领建议**：Sprint-2 **Epic-F 用户资料完善**（若立项）或并入"小程序首次登录完善资料"卡
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）

---

_本文件由 Orchestrator 按需追加；不直接编辑，仅在 Agent Revision Response 产出时同步新增条目。_
