# Tech Review · COSTRA-164 · Round 1

- 被审 Agent：backend
- 本轮产出 commit：`2e71dc8`
- 审核时间：2026-05-27T16:30:00+08:00
- 上轮结论：首轮实装审核
- 审查者装扮：costra-review-tech（D-022 v2.0 + D-025 §2 反模式扫描 + C8-3 runtime）

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：**35/40 分**（≥30 PASS-WITH-FOLLOWUP · ≥36 APPROVE · 差 1 分到 APPROVE）
- **阻塞点**：0 个 P0 / 3 个 P1 / 3 个 P2

> **注**：本报告由 Orchestrator 在 spawn `costra-review-tech` 后接收 final message · 物理落盘（SBAI v1.1 · D-014）

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 实装契合度 | 5/5 | dispatch §2.1 全 6 项 scope（A0/A/B/C/D/E + 联动）完整落地 · 无遗漏 · 无 scope 膨胀 |
| C2 测试充分性 | 4/5 | T1~T10 + 反向验证 ①②③ 全覆盖关键路径 · 但 T6 仅验证 err.code='23505' 未验证 constraint 名（pg-mem 限制）· T4 事务回滚因 pg-mem ROLLBACK 不完整仅验证错误传播未验证 DB 状态 |
| C3 协议契合 | 4/5 | AuthTokenPair OpenAPI required + 代码对齐 · 但 FAMILY_PERSONAL_NOT_DELETABLE 新错误码未同步 docs/api/error-codes.md（ErrorCode.ts 三映射表已完整 · 仅外部文档缺位）|
| C4 错误处理 | 5/5 | isUniqueViolation 双校验（code + constraint）· race condition catch → fallback findPersonalFamily · 极边缘 throw UNAVAILABLE · 非 unique violation 原样 re-throw · 路径完整无遗漏 |
| C5 可读性 | 5/5 | 注释密度恰当 · 函数命名与 dispatch 一致 · ADR/卡号交叉引用 · 职责声明清晰 · 代码结构层次分明 |
| C6 边界与防御 | 4/5 | partial unique index + softDelete kind 守门 + ledger 缺失自愈 · version+1 显式 SET（`familyRepo.ts:191`）· 但 softDelete 缺少 userId 守门参数（familyId + version 即可定位 · 无越权风险但与 Sprint-2 retro 议题候选 5 的 userId 守门范式不完整对齐）|
| C7 文档同步 | 3/5 | history + state.md + follow-ups README 三件套完成 · 但 FAMILY_PERSONAL_NOT_DELETABLE 错误码未入 docs/api/error-codes.md（ErrorCode.ts 约束 §0.2 "新增 code 必须同步 docs/api/error-codes.md + openapi.yaml + client error-mapper"）|
| C8 红线 | 5/5 | C8-1 无 secret 硬编码/主体字样 · C8-2 未触 syncPullService.ts / routes/sync.ts / routes/entries.ts（git diff 空）· C8-3 bootstrap 时延 [未经验测] 标注落实（history §5 + dispatch §7 已有）· pg-mem vs 真 PG 行为差异在 T4 注释中显式暴露 |

## P0 阻塞点（必改）

（无）

## P1 应改

### P1-1 FAMILY_PERSONAL_NOT_DELETABLE 错误码未同步 docs/api/error-codes.md

- **证据**：`server/src/errors/ErrorCode.ts:31` 新增 `FAMILY_PERSONAL_NOT_DELETABLE` 枚举值 · `ErrorCode.ts:74` HTTP 403 映射 · `ErrorCode.ts:118` retry 'none' 映射 · 但 `docs/api/error-codes.md` 中无此条目（`grep -c FAMILY_PERSONAL_NOT_DELETABLE docs/api/error-codes.md` 返回 0）
- **问题**：ErrorCode.ts 文件头部约束（`2e71dc8:ErrorCode.ts:10`）明确声明"新增 code 必须同步 docs/api/error-codes.md + openapi.yaml + client error-mapper"。三处同步只做了 openapi.yaml（ErrorCode enum 自带）和 server 端映射 · 遗漏了面向客户端的文档。COSTRA-165 miniapp-dev 需根据 error-codes.md 实现 error-mapper · 缺此条目将导致客户端无法识别该错误码
- **依据**：ErrorCode.ts §0.2 约束 + dispatch §5.1 工作区铁律（ErrorCode.ts 修改范围包含文档同步义务）
- **修复建议**：在 `docs/api/error-codes.md` §2.3 403 权限段新增一行：
  ```
  | 11 | `FAMILY_PERSONAL_NOT_DELETABLE` | permission | ❌ | ✅ 提示不可删除 | 尝试删除个人 family（kind='personal'· ADR-0007 §5.7.3）|
  ```
  并在 §3 客户端映射表补充 `FAMILY_PERSONAL_NOT_DELETABLE` → 用户可读文案

### P1-2 T6 测试未验证 isUniqueViolation 的 constraint 双校验

- **证据**：`server/test/auth-family-bootstrap.test.ts:234-259` T6 测试第二次 `createPersonalFamily` 抛 unique violation 时仅断言 `err.code === '23505'`（L257）· 注释写"constraint 可能在 pg-mem 中缺失 · 仅验证 code"（L258）· 而 `authService.ts:130-135` 的 `isUniqueViolation` 函数双校验 `code === '23505' && constraint === constraint`
- **问题**：dispatch §2.1 B（v2.0 FU-164-002 落地）要求"双校验 code + constraint · 防误捕其他 unique 约束"。T6 是唯一验证此路径的测试 · 但只验证了 code 单维度。若 pg-mem 不设置 constraint 属性 · 则 isUniqueViolation 在真实 PG 上走 constraint 校验 · 但测试从未验证这个校验是否生效。存在风险：constraint 名拼写错误（如 `uq_families_one_personal_per_owenr`）无法被测试捕获
- **依据**：dispatch §2.1 E T6 "第二次抛 unique violation" + §2.1 B "双校验 code + constraint"
- **修复建议**：
  1. 在 T6 catch 块中增加 `(err as { constraint?: string }).constraint` 的断言（即使 pg-mem 不设置也应有注释说明真 PG 验证路径）
  2. 或在 T8 wxLogin happy path 之外补一个 service 层 isUniqueViolation 单元测试 · 用 mock error 对象验证 constraint 双校验逻辑
  3. 至少在 T6 注释中标注：`[C8-3] constraint 校验在 pg-mem 中无法真实验证 · 留 staging 联合实测时覆盖`

### P1-3 softDelete 缺少 userId 守门参数（Sprint-2 retro 议题候选 5 对齐）

- **证据**：`server/src/repositories/familyRepo.ts:158-204` softDelete 签名 `input: { familyId: string; version: number }` · 无 userId 参数 · SQL `WHERE id = $1 AND deleted_at IS NULL`（L168）和 `WHERE id = $1 AND version = $2 AND deleted_at IS NULL`（L192）均不检查 userId
- **问题**：Sprint-2 retro 议题候选 5（state.md:71）明确提出"service 层 user/family 守门作为 review-tech 强制审查维度"——源于 COSTRA-152 R1 时 entryService.findById 漏写 userId 过滤的同款盲区。当前 softDelete 仅靠 familyId 定位 · 任何知道 familyId 的调用者均可触发软删。虽然 REST DELETE /families 端点尚未暴露（推 COSTRA-201）· 但从防御性编程角度 · repo 层应接收 userId 并在 SQL WHERE 中校验 owner_id · 与 findPersonalFamily 的 userId WHERE 范式一致
- **依据**：Sprint-2 retro 议题候选 5 + state.md:71 "service 层接收 userId 必须有实际使用证据" + `findPersonalFamily` 已正确使用 `WHERE owner_id = $1`
- **修复建议**：将 softDelete 签名改为 `input: { familyId: string; version: number; ownerId: string }` · SQL 加 `AND owner_id = $3` · T10 传 userId 验证。注意：此修改不阻塞 PASS-WITH-FOLLOWUP · 可在 COSTRA-201 落 DELETE /families 时一并补齐 · 但应在 follow-up 中显式登记

## P2 建议

### P2-1 T4 事务回滚测试仅验证错误传播 · 未验证 DB 回滚

- **证据**：`server/test/auth-family-bootstrap.test.ts:177-211` T4 注释"pg-mem 的 ROLLBACK 不完整（已知限制）"· 仅断言异常抛出 · 未断言 DB 无残留行（L208-210 注释"pg-mem ROLLBACK 不完整 · family 行可能残留"）
- **问题**：dispatch §2.1 E T4 期望"bootstrap 事务回滚（mock ledger create 失败）→ user 也回滚 · DB 无任何残留行"· 但 pg-mem 限制导致此期望无法在单测中验证。虽然这是 pg-mem 已知限制（非代码 bug）· 但缺少真 PG 验证路径标注
- **修复建议**：在 T4 注释中补充 `[C8-3] pg-mem ROLLBACK 语义不完整 · 真实 PG 事务回滚行为需 staging 联合实测验证 · FU-164-006 锚定`

### P2-2 refresh 路径中 default_family_id/default_ledger_id 可能返回空字符串

- **证据**：`server/src/services/authService.ts:257-266` refresh 函数中 · 若 `findPersonalFamily` 返回 null（理论上不应发生 · 但数据异常时可能）· `defaultFamilyId` 和 `defaultLedgerId` 保持为空字符串 `''` · 而 OpenAPI schema 声明这两个字段为 `format: uuid` + `required`
- **问题**：AuthTokenPair 接口注释声明"永远非空"（`authService.ts:55-58`）· wxLogin 路径有 withTx 事务保证非空 · 但 refresh 路径缺少同样的保证。空字符串不是合法 UUID · 违反 OpenAPI 契约
- **修复建议**：在 refresh 路径中 · 若 `findPersonalFamily` 返回 null · 应与 wxLogin 一致走 bootstrap 自愈路径（或抛 UNAVAILABLE）· 不应返回空字符串。此修改优先级较低（refresh 场景下 personal family 不存在是极边缘数据异常）· 但应在 follow-up 登记

### P2-3 openapi.yaml 缺少 FAMILY_PERSONAL_NOT_DELETABLE 的 ErrorCode enum 值

- **证据**：`server/api/openapi.yaml` components.schemas.ErrorCode enum 列表中未包含 `FAMILY_PERSONAL_NOT_DELETABLE`（grep 返回 0 匹配）· 而 `ErrorCode.ts:31` 已新增此值
- **问题**：ErrorCode.ts 约束要求"新增 code 必须同步 openapi.yaml"。当前 openapi.yaml 的 ErrorCode schema 可能是自由格式字符串而非 enum · 需确认是否需要补齐
- **修复建议**：若 openapi.yaml ErrorCode 是 enum 类型 · 补 `FAMILY_PERSONAL_NOT_DELETABLE` 值；若为自由格式 string · 仅需确认 docs/api/error-codes.md 同步即可（与 P1-1 合并修复）

## D-025 反模式扫描结论

| AP | 命中 | 证据 |
|---|---|---|
| AP-001 字符串代理判定 | ❌ 不命中 | kind ENUM 是显式状态枚举 · personal/shared 由 DB ENUM + repo 强制赋值 · `familyRepo.ts:83` kind 硬编码 'personal' · 非字符串推断 |
| AP-002 概率极低就接受 | ❌ 不命中 | partial unique index 物理消除多 personal（不是"概率低"接受）· race condition 走 catch+fallback 自愈（不是"概率低"接受）· 极边缘路径 throw UNAVAILABLE（不是静默接受）|
| AP-003 契约-实装漂移 | ⚠️ 已知命中（不阻塞）| /families/* L161-319 共 6 端点无实装无 x-deferred · 与 dispatch v2.1 §3 声明一致 · 推 COSTRA-161/COSTRA-201 · 不引入新漂移 |

**结论**：命中 1 条 AP-003（已知隐性漂移 · P2 级 · 不阻塞）· AP-001/002 均不命中

## C8 红线判定

| 子项 | 得分 | 证据 |
|---|---|---|
| C8-1 runtime 实测必须性 | 1/1 | 本卡非 runtime 类 T2 卡（纯 server 端 · 不涉及微信 SDK 启动时序/渲染层/平台 API）· 但 bootstrap 时延需 staging 实测 · 已有 DoD 标注 |
| C8-2 跨版本对照 | 1/2 | 不涉及 SDK 版本变更 · 本卡 N/A · 得 1 分 |
| C8-3 平台 SDK 假设标注 | 1/1 | bootstrap 事务时延 < 30ms 已标注 `[未经验测]`（history §5 + dispatch §7 L506-507）· pg-mem vs 真 PG 行为差异在 T4 注释（L179-180）和 T6 注释（L258）显式暴露 |
| C8-4 错误路径 runtime 验证 | 1/1 | T6 partial unique violation 测试在 pg-mem 中触发（非 mock）· T3 ledger 缺失自愈实测验证 · T4 事务回滚有 pg-mem 限制标注 |
| **合计** | **4/5** | |

## 与上轮的差异

N/A（首轮实装审核）

## 给被审 Agent 的回执指令

Orchestrator 拉起 backend-dev 时，请附上本文件全文，并要求其：
1. **P1-1**：补充 `FAMILY_PERSONAL_NOT_DELETABLE` 到 `docs/api/error-codes.md` §2.3 403 段 + §3 客户端映射表
2. **P1-2**：T6 catch 块补 constraint 断言或 isUniqueViolation 独立单测 · 至少标注 `[C8-3] pg-mem constraint 验证限制`
3. **P1-3**：softDelete 签名加 `ownerId` 参数 + SQL WHERE 加 `owner_id` 守门（或显式登记 FU 由 COSTRA-201 一并落地）
4. P2 全部记入下一 Sprint backlog

## 自我反思

- 本次审核耗时估计：45 分钟
- 置信度：高
  - 全部 12 文件逐一 Read + 关键行号 grep 验证 ✓
  - 80/80 测试物理执行验证 ✓
  - typecheck 物理执行通过 ✓
  - 工作区铁律 git diff 空验证 ✓
  - AppID 在 server/.env 中（非 miniprogram 打包源码）· 不违反 C8-2 红线 ✓
  - session_key/openid 仅用于 upsert 参数传递 · 无日志泄漏 ✓
  - 无 console.log/TODO/FIXME ✓
  - 所有文件 < 500 行 ✓
- 若低：建议 Orchestrator 转 Human 二裁（不需要 · 置信度高）
