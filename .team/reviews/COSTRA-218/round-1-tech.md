# Tech Review · COSTRA-218 · Round 1 · T3 Retrospective

- 被审 Agent：backend-dev
- 本轮产出 commit：`07e0a52`（chore 合并 commit，含多卡多域变更）
- 审核时间：2026-06-02T12:57:00+08:00
- 上轮结论：首轮（T3 追溯）
- 审核角色：review-tech（只读审查 · Orchestrator 物理落盘）

---

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：30/35 分
- **阻塞点**：0 个 P0 / 0 个 P1 / 5 个 P2 / 3 个 INFO

结论：本卡可按 D-013 T3 追溯档自动关闭。P2 均登记为 follow-up，不阻塞 Family First baseline，也不阻塞 `COSTRA-221` 派单准备。

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---:|---|
| 契约一致性 | 4/5 | GET/POST 响应字段与 OpenAPI Category schema 对齐；POST 缺 Idempotency-Key 处理，OpenAPI 已定义参数但路由未接入，属 P2 遗留 |
| 架构与分层 | 5/5 | categoryRepo/categoryService/routes 三层分离清晰，职责单一，遵循 entryRepo/entryService/entries.ts 同构范式 |
| 数据与持久化 | 4/5 | 二级层级校验正确（应用层 + DB trigger 双保险）；同名去重双保险（应用层 + DB UNIQUE）；pg-mem 不支持 COALESCE 唯一索引属已知限制 |
| 离线与同步 | 5/5 | Backend=N/A |
| 安全与合规 | 4/5 | family_id 权限守门正确（isUserInFamily + left_at IS NULL）；无主体硬编码/AppID 泄漏/session_key 泄漏；createCategory 层级校验中 findById 未做 family_id 归属校验（P2） |
| 可测与可观测 | 4/5 | T1~T8 覆盖主路径/权限/错误/重复/层级，8/8 全绿；缺 POST 无 token → 401 和 POST 非 member → 403 显式单测 |
| 工程纪律 | 4/5 | 多卡 chore commit `07e0a52` 违反单卡即提交铁律（已成事实不可逆）；无 TODO/FIXME/console.log；文件行数均在阈值内 |

---

## P0 阻塞点（必改）

无。

## P1 应改

无。

---

## P2 建议

### P2-1 POST /categories 未接入 Idempotency-Key

- **证据**：`server/src/routes/categories.ts` POST handler 无 Idempotency-Key header 校验/存储逻辑；`server/api/openapi.yaml` 对 POST /categories 已定义 `IdempotencyKey` 参数。
- **问题**：OpenAPI 声明 POST /categories 接受 Idempotency-Key 参数，但路由层未接入 idempotencyService。dispatch §C3 标注“可选，MVP 阶段不强制”，但 OpenAPI 参数定义与实装之间仍存在 AP-003 契约漂移。
- **依据**：D-025 AP-003 契约-实装漂移；dispatch §C3 “Header: Idempotency-Key（可选，MVP 阶段不强制）”。
- **修复建议**：
  1. 接入 idempotencyService；或
  2. OpenAPI 加 `x-deferred` 标记 + follow-up 登记。

推荐 MVP 阶段先标记/登记，`COSTRA-221` 实装家庭管理 API 时一并补齐幂等策略。

### P2-2 createCategory 层级校验中 findById 未做 family_id 归属校验

- **证据**：`server/src/services/categoryService.ts` 中 `categoryRepo.findById(payload.parent_id)` 查到的 parent 可能属于其他 family。
- **问题**：若用户 A（family X）传 `parent_id` 指向 family Y 的一级分类，findById 会返回该分类，因其 `parentId === null` 通过层级校验，但实际语义上 parent 应属于同一 family。
- **风险评估**：实际风险较低。insert 时 `family_id` 取自 payload（当前用户 family），DB UNIQUE 约束 + 应用层去重都基于 payload.family_id，不会真正写入错误 family；但 parent 归属语义存在缝隙。
- **依据**：COSTRA-152 跨 family 守门范式；service 层接收 id 时应证明归属。
- **修复建议**：findById 后追加 `parent.familyId === payload.family_id || parent.familyId === null` 校验；不符合则拒绝。

### P2-3 isUserInFamily 与 syncPullService 重复

- **证据**：`server/src/services/categoryService.ts` 与 `server/src/services/syncPullService.ts` 中均存在 inline `isUserInFamily` 实现（SQL + family_members + left_at IS NULL）。
- **问题**：违反 DRY 原则，两处同步维护成本高。
- **依据**：history P2 已登记 `FU-154-FAMILY-MEMBER-REPO`。
- **修复建议**：`COSTRA-221` 家庭管理 API 实装时统一抽 `familyMemberRepo.isUserInFamily()` 公共函数。

### P2-4 缺 POST /categories 无 token → 401 和 POST 非 member → 403 显式单测

- **证据**：`server/test/categories.test.ts` 中 GET 有无 token / 非成员用例，但 POST describe 块未见对应显式用例。
- **问题**：POST 路由同样有 parseUserId + isUserInFamily 守门，但缺独立单测覆盖。虽然代码路径与 GET 共享守门逻辑，独立端点仍应显式覆盖。
- **依据**：dispatch §C5 T1~T8 定义；T1/T4 当前主要覆盖 GET。
- **修复建议**：补充 T9（POST 无 token → 401）+ T10（POST 非 member → 403）。

### P2-5 多卡 chore commit 违反单卡即提交铁律

- **证据**：commit `07e0a52` 包含 COSTRA-218 后端代码 + COSTRA-220 miniapp 代码 + 多张 dispatch/history/qa 文档，共 30+ 文件变更。
- **问题**：违反 Conventional Commits 语义和 D-012 单卡即提交铁律，git blame/bisect 困难。
- **依据**：`.team/reviews/audit-217-220.md` GAP-5；`.team/STATE` 铁律 2。
- **修复建议**：已成事实不可逆。后续严格执行单卡即提交，`COSTRA-221` 起每卡独立 commit。

---

## INFO 观察项

### INFO-1 pg-mem 不支持 COALESCE 唯一索引

- **证据**：`server/db/migrations/0008_categories_hierarchy_seed.sql` 中 `uq_categories_family_name_type_parent` 使用 `COALESCE(family_id, '00000000-...')` 语法。
- **说明**：pg-mem 不支持含 COALESCE 的唯一索引，应用层同名去重已在 categoryService 补充。真实 PG 行为由 DB 约束兜底。与 COSTRA-217 R4 P2-1 同族。
- **处置**：已登记 `FU-217-PG-SEED-ASSERT`，Sprint-4 guardrails 阶段补真实 PG 集成测试。

### INFO-2 T3 测试种子数据与真实 seed 数量差异

- **证据**：`server/test/categories.test.ts` 测试插入简化分类，而非 73 条真实系统分类。
- **说明**：pg-mem 不执行 0008 migration seed，测试用简化数据验证逻辑正确性，符合 pg-mem 限制下的合理策略。
- **处置**：同 INFO-1，真实 PG 集成测试补 73 条断言。

### INFO-3 CategoryResponse 使用 snake_case 与 OpenAPI 对齐

- **证据**：`server/src/services/categoryService.ts` 中 `CategoryResponse` 字段为 `family_id` / `sort_order` / `is_system` / `parent_id` / `is_direct_default` / `children_count`。
- **说明**：与 OpenAPI Category schema 字段名对齐。内部 `CategoryEntity` 使用 camelCase，`entityToResponse` 做转换。设计正确。

---

## D-025 反模式扫描表

| AP | 命中 | 证据 / 否决理由 |
|---|---|---|
| AP-001 字符串代理判定 | ☐ No | 无业务字段字符串硬比较推断语义。type 使用枚举 `'income'/'expense'`，isSystem/isDirectDefault 使用布尔字段。 |
| AP-002 概率极低就接受 | ☐ No | 无“概率极低就接受”的边界缺陷。层级校验有应用层 + DB trigger 双保险；同名去重有应用层 + DB UNIQUE 双保险。 |
| AP-003 契约-实装漂移 | ☑ Yes（P2） | POST /categories OpenAPI 定义 Idempotency-Key 参数但路由未接入。dispatch 已标注“MVP 阶段不强制”但 OpenAPI 无 x-deferred 标记。属非阻塞型 gap，登记 P2-1。 |
| AP-004-X 主体硬编码 | ☐ No | server 源码无硬编码主体字样。`subject.ts` 是 D-008 可配置设计。 |
| AP-004-Y session_key/secret 泄漏 | ☐ No | 未发现 console.log/fmt.Printf 泄漏。code2Session.ts 有 secret 脱敏。 |
| AP-004-Z AppID 硬编码 | ☐ No | server/src 未发现生产 AppID 硬编码。 |

结论：命中 1 条 AP-003（P2 · 非阻塞 · follow-up）。

---

## T3 追溯收口建议

### 是否可自动关闭

| 条件 | 状态 |
|---|---|
| AI-Review PASS | ✅ PASS-WITH-FOLLOWUP 30/35 |
| 残余 P0/P1=0 | ✅ 0 P0 / 0 P1 |
| 无红线 | ✅ 无 AP-004 红线命中 / 无主体硬编码 / 无 AppID 泄漏 / 无 session_key 泄漏 |
| 无新阻塞 | ✅ 5 个 P2 均不阻塞 |

建议：**T3 自动关闭**。

理由：

1. 0 P0 / 0 P1，无红线命中。
2. Family First baseline 已由 Human 验收通过（三份测试手册全 PASS）。
3. P2-1~P2-5 均登记 follow-up，不阻塞 `COSTRA-221`。

---

## Follow-up 登记

| 编号 | 描述 | 来源 | 严重度 | 建议处置 |
|---|---|---|---|---|
| FU-218-IDEMPOTENCY-KEY | POST /categories Idempotency-Key 未接入 | P2-1 | P2 | `COSTRA-221` 实装时补齐或 OpenAPI 加 x-deferred |
| FU-218-PARENT-FAMILY-CHECK | createCategory findById 未校验 parent 归属 family | P2-2 | P2 | `COSTRA-221` 或独立小卡 |
| FU-218-FAMILY-MEMBER-REPO | isUserInFamily 与 syncPullService 重复 | P2-3 | P2 | 同 audit-217-220 已登记 · `COSTRA-221` 统一抽公共函数 |
| FU-218-POST-TEST-COVERAGE | POST 无 token / 非 member 单测缺失 | P2-4 | P2 | 下次触及 categories 测试时补 T9/T10 |
| GAP-COMMIT-07E0A52 | chore commit 多卡多域 | P2-5 | P2 | 已成事实 · 后续预防 |

---

## 证据路径

### 产出文件

- `server/src/repositories/categoryRepo.ts`
- `server/src/services/categoryService.ts`
- `server/src/routes/categories.ts`
- `server/test/categories.test.ts`
- `server/src/app.ts`

### 契约源

- `server/api/openapi.yaml` categories paths
- `server/api/openapi.yaml` Category / CategoryCreate schemas

### 参考文件

- `.team/dispatch/COSTRA-218-backend-categories-api.md`
- `.team/members/backend-dev/history/2026-06-09-costra-218-categories-api.md`
- `.team/reviews/audit-217-220.md`
- `qa/current-stage-acceptance-family-first-baseline.md`
- `server/db/migrations/0008_categories_hierarchy_seed.sql`
- `server/src/errors/ErrorCode.ts`
- `server/src/repositories/familyRepo.ts`
- `.team/decisions/D-025-anti-patterns-clipboard.md`

### 闸门验证（交付 history 记录）

- `npm run typecheck`：✅ 0 error
- `npm run test`：✅ 108/108 PASS（含 categories.test.ts 8/8）

---

## 给被审 Agent 的回执指令

Orchestrator 后续拉起 backend-dev 或相关卡时，请附上本文件全文，并要求：

1. 确认 P2-1~P2-5 已知悉并登记 follow-up。
2. P2-2（parent 归属校验）建议在 `COSTRA-221` 实装时一并修复。
3. P2-4（POST 单测）建议下次触及 categories 测试时补齐。
4. P2-5（chore commit）后续严格执行单卡即提交。
5. 所有 P2 记入下一 Sprint backlog。

---

## 自我反思

- 本次审核耗时估计：35 分钟。
- 置信度：高。
- 核心判断：
  1. 代码质量良好，三层分离清晰，遵循既有范式。
  2. 权限守门正确（isUserInFamily + left_at IS NULL），无数据泄漏风险。
  3. 无红线命中（无主体硬编码、AppID 泄漏、session_key 泄漏）。
  4. P2-2（parent 归属校验）是唯一的逻辑缝隙，但实际风险低。
  5. AP-003 命中但属非阻塞型。
  6. chore commit 是工程纪律问题，已成事实不推翻基线。

---

**本轮 review-tech:COSTRA-218 完成 · T3 Retrospective · Orchestrator 落盘 · 2026-06-02**
