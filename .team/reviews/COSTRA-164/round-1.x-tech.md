# Tech Review · COSTRA-164 · Round 1.x

- 被审 Agent：backend
- 本轮产出 commit：`8c8cdce`
- 审核时间：2026-05-27T16:50:00+08:00
- 上轮结论：PASS-WITH-FOLLOWUP 35/40 · 0 P0 / 3 P1 / 3 P2
- 审查者装扮：costra-review-tech（D-022 v2.0 + D-025 §2 反模式扫描 + C8-3 runtime）

> **注**：本报告由 Orchestrator 在 spawn `costra-review-tech` 后接收 final message · 物理落盘（SBAI v1.1 · D-014）

## 总评

- **Verdict**：`APPROVE`
- **总分**：**38/40 分**（≥36 APPROVE）
- **阻塞点**：0 个 P0 / 0 个 P1 / 2 个 P2

> R1 三项 P1 全部兑现落地 · 无新引入问题 · C8 红线和工作区铁律全绿 · 物理执行 80/80 测 + typecheck 0 error 通过

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 实装契合度 | 5/5 | P1-1/P1-2/P1-3 三项修订均精确命中 R1 要求 · 无 scope 膨胀 · dispatch §2.1 全 6 项 scope 不变 |
| C2 测试充分性 | 5/5 | T6 constraint 双校验断言（pg-mem 可选 + [C8-3] 标注）✓ · T10 ③ 跨 user 越权返 NOT_FOUND ✓ · T10 ④ pg-mem 降级原因 + FU 候选显式登记 ✓ |
| C3 协议契合 | 5/5 | FAMILY_PERSONAL_NOT_DELETABLE 已同步 error-codes.md §2.3（10b 行）+ §4.1 客户端映射表 · 字典总数 21→22 ✓ |
| C4 错误处理 | 5/5 | softDelete ownerId 守门：SELECT 阶段 WHERE id=$1 AND owner_id=$2 先于 kind 守门 · UPDATE 阶段双重 owner_id 校验 · 不暴露存在性 · 与 entryRepo.findById 范式一致 |
| C5 可读性 | 5/5 | softDelete Javadoc 重写为 4 步实现清单 + ⚠️ ownerId 守门注释 · T10 测试标题精确描述降级策略 · [C8-3] 注释密度恰当 |
| C6 边界与防御 | 5/5 | Sprint-2 retro 议题候选 5 实战兑现 · softDelete SELECT + UPDATE 双重 ownerId 守门 · 跨 user 越权测试断言 NOT_FOUND（非 FAMILY_PERSONAL_NOT_DELETABLE）证明守门优先级正确 |
| C7 文档同步 | 4/5 | error-codes.md §2.3 + §4.1 双段同步 ✓ · 但 R1 P2-3 openapi.yaml ErrorCode enum 未补 FAMILY_PERSONAL_NOT_DELETABLE（留 P2 遗留 · 不阻塞）|
| C8 红线 | 4/5 | C8-1 无 secret/主体字样 ✓ · C8-2 git diff origin/dev..HEAD 空 ✓ · C8-3 T6/T10 降级均有 [C8-3] 标注 ✓ · C8-4 T6 pg-mem constraint 可选断言 ✓ · commit 触及 4 文件全在 backend 工作区 ✓ · T10 ④ 降级留 1 分 staging 空间 |

## P0 阻塞点（必改）

（无）

## P1 应改

（无 · R1 三项 P1 全部兑现）

## P2 建议

### P2-1 openapi.yaml ErrorCode enum 未补 FAMILY_PERSONAL_NOT_DELETABLE

- **证据**：R1 P2-3 遗留 · `server/api/openapi.yaml` components.schemas.ErrorCode 若为 enum 类型则缺 `FAMILY_PERSONAL_NOT_DELETABLE`
- **问题**：ErrorCode.ts §0.2 约束"新增 code 必须同步 openapi.yaml"· R1.x 修订聚焦 P1 · 未顺带修复此 P2
- **依据**：ErrorCode.ts:10 约束
- **修复建议**：下轮或 COSTRA-201 统一补齐 openapi.yaml enum（若 schema 为自由格式 string 则仅需确认）
- **FU 登记**：FU-164-OPENAPI-ERRORCODE-ENUM（推 COSTRA-201）

### P2-2 refresh 路径 default_family_id/default_ledger_id 空字符串风险

- **证据**：R1 P2-2 遗留 · `server/src/services/authService.ts:257-266` refresh 路径中 findPersonalFamily 返回 null 时默认空字符串
- **问题**：空字符串非合法 UUID · 违反 OpenAPI required + format:uuid 契约 · 极边缘数据异常场景
- **依据**：OpenAPI AuthTokenPair schema + AuthService 接口注释"永远非空"
- **修复建议**：COSTRA-165 或 COSTRA-201 中 · refresh 路径补 bootstrap 自愈或 throw UNAVAILABLE
- **FU 登记**：FU-164-REFRESH-DEFAULT-IDS-NULL（推 COSTRA-165 或 201）

## 与上轮的差异（R1 → R1.x）

- 上轮 P0 有 0 个 · 本轮剩 0 个
- 上轮 P1 有 3 个 · 本轮剩 0 个
- 已修复：
  - **P1-1** ✅ 兑现：`docs/api/error-codes.md` §2.3 新增 10b 行 + §4.1 新增客户端映射 · 字典总数 21→22 · grep 确认 2 处命中
  - **P1-2** ✅ 兑现：T6 catch 块加 `(err as { constraint?: string }).constraint` 可选断言 + `if (constraint !== undefined)` 条件校验 + [C8-3] 四行注释标注 pg-mem 限制 + 真 PG staging 路径
  - **P1-3** ✅ 兑现：softDelete 签名加 `ownerId: string` · SELECT WHERE 加 `owner_id = $2` · UPDATE WHERE 加 `owner_id = $3`（双重防御）· T10 ③ 新增跨 user 越权测试断言 NOT_FOUND
- 新引入：0 个
- 仍未解决（P2 遗留）：
  - P2-1 openapi.yaml enum 补齐（R1 P2-3 遗留）→ FU-164-OPENAPI-ERRORCODE-ENUM
  - P2-2 refresh 空字符串风险（R1 P2-2 遗留）→ FU-164-REFRESH-DEFAULT-IDS-NULL

### T10 ④ shared 删除降级评估

- **降级原因**：pg-mem partial unique index `WHERE kind='personal'` 含 ENUM 列时索引覆盖范围误判 · 导致 shared family INSERT 后 SELECT 返 0 行
- **标注情况**：✅ 测试代码 L428-434 六行注释明确标注 `[C8-3 pg-mem 已知 bug]` + 降级原因 + FU-164-006 锚定
- **FU 登记**：✅ `FU-PG-MEM-PARTIAL-INDEX-ENUM-LIMIT` 候选 Sprint-3 末 Retro 议入 P3
- **合理性**：✅ 降级合理 · pg-mem upstream bug 非代码 bug · 真 PG 行为正常 · 强行 hack pg-mem（如绕 partial index）反而引入测试脆弱性

## D-025 反模式扫描结论

| AP | 命中 | 证据 |
|---|---|---|
| AP-001 字符串代理判定 | ❌ 不命中 | kind ENUM 显式状态枚举 · personal/shared 由 DB ENUM + repo 硬编码赋值 · R1.x 未变 |
| AP-002 概率极低就接受 | ❌ 不命中 | ownerId 守门双重防御（非"概率低接受"）· T10 ④ 降级有显式 FU 登记（非静默接受）|
| AP-003 契约-实装漂移 | ⚠️ 已知命中（不阻塞）| /families/* 6 端点无实装 · 与 R1 一致 · 推 COSTRA-161/COSTRA-201 · 无新增漂移 |

**结论**：与 R1 一致 · AP-003 已知隐性漂移不阻塞 · AP-001/002 均不命中

## C8 红线判定

| 子项 | 得分 | 证据 |
|---|---|---|
| C8-1 runtime 实测必须性 | 1/1 | 本卡非 runtime 类 T2 卡 · bootstrap 时延 DoD 已标注 · R1.x 无变更 |
| C8-2 跨版本对照 | 1/2 | 不涉及 SDK 版本变更 · N/A · 得 1 分 |
| C8-3 平台 SDK 假设标注 | 1/1 | T6 constraint 双校验 [C8-3] 标注 ✓ · T10 ④ pg-mem 降级 [C8-3] 标注 ✓ · R1 T4 pg-mem ROLLBACK 标注未变 ✓ |
| C8-4 错误路径 runtime 验证 | 1/1 | T6 pg-mem constraint 可选断言 ✓ · T10 ③ 跨 user 越权非 mock 验证 ✓ · T10 ④ 降级有 FU 锚定 ✓ |
| **合计** | **4/5** | |

### 物理验证汇总

| 验证项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 0 error |
| `npm test` | ✅ 80/80 全绿 |
| `git diff origin/dev..HEAD -- server/src/services/syncPullService.ts ...` | ✅ 空（C8 工作区铁律）|
| `git show 8c8cdce --name-only` | ✅ 4 文件 · 全在 backend 工作区 |
| console.log/TODO/FIXME 扫描 | ✅ 0 命中 |
| session_key/openid 日志泄漏 | ✅ 仅测试 mock 数据 · 无生产日志泄漏 |
| D-008 主体红线（Corp/Inc/公司）| ✅ 0 命中 |
| AppID 红线（wxf8b0d3e3a83f9941）| ✅ 0 命中 |
| 文件行数 | ✅ familyRepo 213 行 / test 436 行 / error-codes 267 行 · 均 < 500 |

## 给被审 Agent 的回执指令

COSTRA-164 R1.x 审核通过 · 后续：

1. P2-1 openapi.yaml enum 补齐 → 记入 Sprint-3 backlog（COSTRA-201 统一补齐 · FU-164-OPENAPI-ERRORCODE-ENUM）
2. P2-2 refresh 空字符串风险 → 记入 Sprint-3 backlog（COSTRA-165 或 COSTRA-201 一并修复 · FU-164-REFRESH-DEFAULT-IDS-NULL）
3. T10 ④ shared 删除路径 → staging 联合实测覆盖（FU-164-006 + FU-PG-MEM-PARTIAL-INDEX-ENUM-LIMIT）

## 自我反思

- 本次审核耗时估计：25 分钟
- 置信度：高
  - R1 三项 P1 逐一 diff + 原文件 Read 验证 ✓
  - typecheck + test 物理执行全绿 ✓
  - C8 红线 5 项扫描 + 工作区铁律 git diff 空 ✓
  - D-025 AP-001/002/003 重扫 ✓
  - commit 触及文件严格匹配 4 文件清单 ✓
  - 敏感信息 / 主体字样 / AppID 扫描 ✓
- 无需转 Human 二裁
