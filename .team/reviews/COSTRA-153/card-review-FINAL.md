# COSTRA-153 卡定义 Review · 最终结论

- 终止时间：2026-05-22 18:55
- 终止原因：**PASS-WITH-FOLLOWUP**
- 总轮次：2/3
- 最后一轮 verdict：PASS-WITH-FOLLOWUP（R2 形式审 26/30）
- 最终得分：**26/30**
- 分流归属：Review-Tech（backend-dev feature · server/ 主产物）
- Verdict 演进：R1 REVISE 22/30 → R2 PASS-WITH-FOLLOWUP 26/30（+4）

## 轮次摘要

| 轮 | Verdict | 得分 | 关键事项 |
|---|---|---|---|
| R1 | REVISE | 22/30 | P0-1（A/B 决策未决）+ P1×3（DoD 19 项 / 409 体 / version 强制 required）+ P2×2（常量值 / OpenAPI 401/403/409）= 6 项 FU-153-001~006 + §LINKAGE 联合决策（K3 + query version）|
| R2 形式审 | PASS-WITH-FOLLOWUP | 26/30 | 6/6 FU 全落地 ✅ · §LINKAGE 决策 2 query 全 3 锚点显式 ✅ · C1/C2/C4/C5 共回升 4 分 |

## §LINKAGE 联合决策（双卡共享）

- **决策 1 K3 method-override**（与 152 共享）：拍板 K3 · 153 不需要（DELETE 是标准 HTTP method）
- **决策 2 DELETE version 传递**：拍板方案 A query `?version=N`

## Follow-up（R1 实装期必验 · 不阻启动）

### R2 留观察项 · 跨 family 越权 T6 真 P0 守门点

- **风险**：v2.0 dispatch §7 已暴露 · entryRepo.findById 仅 JOIN family_members 不按 userId 过滤 · entryService.findById(userId, entryId) 接收 userId 但未实际使用 · 当前任意 userId 查任意 entry 都能成功（只要 entry 的 family 至少有一个成员）
- **要求**：backend-dev R1 期间必须验证 T6 单测能否真的拦截跨 family · 若不能 → 必须在 service 层加 `isUserInFamily(userId, familyId)` 守门
- **若 R1 实装期发现服务层无守门**：同 R1 一并修补（不分两次 commit · 单装扮档单 commit 铁律）· 不视为新增 scope
- **影响范围**：本卡 T6 + 152 T7 + 已存在的 GET /entries/{id}（COSTRA-104 实装漏洞 · 144 行起 entries.ts L138-163）· 三处共享守门补丁

### Sprint-3 末 Retro 议题候选

- **跨 family 越权守门盲区**：COSTRA-104 R1 实装时漏 · review-tech 36/40 漏检 · Sprint-3 末 Retro 议入"service 层 user/family 守门作为强制审查维度"

## Human 决策（如冒泡）

无需 Human 介入（卡定义 PASS-WITH-FOLLOWUP 路径不过 Human · SOP-CARD-REVIEW §9）

## 进 Todo 时间

2026-05-22 18:55（与 152 同时 · backend-dev 双卡联合 R1 实装可启）

---

**本卡定义 Review 已结束 · 等待 Orchestrator 同对话轮 spawn `costra-backend-dev` 装扮档启动 R1 实装（建议与 152 联合启动 · 同文件 routes/entries.ts · 同 entryService · §LINKAGE 决策面已定）。**
