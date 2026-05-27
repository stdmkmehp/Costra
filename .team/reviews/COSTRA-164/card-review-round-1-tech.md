# Card Review · Tech · COSTRA-164 · Round 1

- 卡 Owner：backend-dev
- 卡类型：feature（server family bootstrap MVP · 首登 atomic 建个人 family + ledger）
- 卡 points：3
- 审核时间：2026-05-27T11:30:00+08:00
- 上轮结论：首轮
- 审查者装扮：costra-card-reviewer-tech（D-022 v2.0 + D-025 §2 反模式扫描）

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：**25/30 分**
- **阻塞点**：0 个 P0 / 3 个 P1 / 3 个 P2

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 5/5 | 标题精炼含核心动作 · 描述三要素（背景/目标/范围）齐备 · 术语与 ADR-0007 完全一致 · "INVEST small" 标注准确 |
| C2 DoD 可度量 | 4/6 | G1~G16 + T1~T9 + 反向验证 3 项共 21 条 · T6/T9 可自动化判定 · 但 T6 race condition 测试"service 层应捕获并 fallback"的期望行为未在 dispatch 中定义具体代码路径（catch 哪个 error code？fallback 逻辑在哪层？）· 反向验证 ③ "T6 应 FAIL"的判定标准模糊（unique violation 不抛 ≠ 重复 INSERT 成功） |
| C3 依赖识别 | 4/5 | 上游 COSTRA-101 + COSTRA-021 显式列出 · 下游 COSTRA-165 强依赖清晰 · 但缺少对 withTransaction 工具已有（pool.ts L45-62）的事实确认依赖 · dispatch §7 风险条目仍写"withTransaction 工具是否已存在 · 需先核查"——此依赖在审核时已可确认 |
| C4 产出物具体 | 4/5 | 文件路径+函数签名+测试文件名具列 · migration SQL 完整到可直接执行 · OpenAPI diff 明确 · 但 familyRepo.createPersonalFamily 的 race condition catch + fallback findPersonalFamily 逻辑仅在注释中声明（§2.1 A L143），未在 wxLogin 扩展代码（§2.1 B）中体现该 catch 路径 |
| C5 风险与边界 | 3/4 | §7 列 5 项风险 · v1.1 消除"多个 personal family"风险正确 · migration prod 部署路径已锚定 · 但缺少 withTransaction 事务超时/死锁边界说明 · bootstrap 事务 < 30ms 预期缺实测基线 · "DELETE /families kind=personal 拒绝推 Sprint-4"未考虑是否需 service 层守门接口 |
| C6 去重 | 3/3 | backlog.json 中无 COSTRA-164/165 条目 · board.md 无覆盖 · 近期 daily 无相似描述 · ADR-0007 §6.1 实装锚点与 164 scope 一一对应无重叠 |
| C7 估点 | 2/2 | 3 点 vs 152（3pt 同类 backend）合理 · 6 项 scope 单点密度可控 · 落 1~8 区间 · v1.1 加 migration+kind 后仍属 small |
| C8 红线 | Pass | Won't-Have（charter §5）未触碰 · 无 secret 硬编码 · 无主体字样（D-008）· backend-dev 写 server/ 合规 · /sync/pull 铁律（ADR-0007 §5.5）显式标禁 · OpenAPI 改动仅在 AuthTokenPair 不动 /families/* |

| **总分** | **25/30** | **PASS-WITH-FOLLOWUP** |

---

## P0 阻塞点

（无）

---

## P1 应改

### P1-1 withTransaction 工具已存在 · dispatch §7 风险条目 + §5.1 工作区铁律冗余/矛盾

- **证据**：
  - dispatch §7 "withTransaction 工具是否已存在：本卡需先核查 `server/src/db/` · 若无需新建 · 若有则复用"
  - dispatch §5.1 可写清单含 `server/src/db/transaction.ts（如需新建 withTransaction 工具 · 视现状）`
  - 实际：`server/src/db/pool.ts` L45-62 已有 `withTx<T>` 函数，签名完全满足本卡需求（`fn: (client: PoolClient) => Promise<T>`）
  - `ls server/src/db/` 仅含 `pool.ts` + `redis.ts`，无 `transaction.ts`
- **问题**：
  1. dispatch §7 风险条目"需先核查"在 Card-Review 阶段已可确认——这是已知非未知风险
  2. §5.1 工作区铁律写 `transaction.ts（如需新建）`造成实装歧义：backend-dev 可能误以为需新建文件
  3. §2.1 B wxLogin 代码用 `withTransaction` 但实际函数名是 `withTx`——命名不一致
- **依据**：SOP-CARD-REVIEW §3 C3（依赖识别）+ C4（产出物具体）
- **修复建议**：
  1. dispatch §7 删除"withTransaction 工具是否已存在"风险条目（转为"已确认 pool.ts:withTx 复用"）
  2. §5.1 可写清单删除 `server/src/db/transaction.ts` 条目
  3. §2.1 B wxLogin 伪代码中 `withTransaction` → `withTx`（与 pool.ts 一致）· 或声明"本卡统一用 pool.ts 已有 withTx · 不新建 transaction.ts"
  4. §2.1 B 补 import 路径：`import { withTx } from '../db/pool.js'`
- **FU 编号**：**FU-164-001**（D-016 强制 R1 修订）

### P1-2 T6 race condition 测试期望行为不完整 · service 层 catch+fallback 路径未定义

- **证据**：
  - dispatch §2.1 E T6："直接调 familyRepo.createPersonalFamily 两次同一 owner · 第二次抛 unique violation · service 层应捕获并 fallback findPersonalFamily 返回首次创建的 family（race condition 自愈）"
  - dispatch §2.1 A L143："若 race condition 重复 INSERT 会触发 unique violation · service 层应捕获并 fallback findPersonal"
  - 但 §2.1 B wxLogin 扩展代码中**完全没有 catch unique violation + fallback findPersonalFamily 的逻辑**——代码仅做 `if (!personalFamily) { createPersonalFamily } else { findFirstByFamilyId }`，无 try-catch 包裹
- **问题**：T6 期望"service 层应捕获并 fallback"，但 dispatch 定义的核心 wxLogin 代码没有这条路径。这导致：
  1. T6 测试的期望行为在 dispatch 中无对应实装定义——reviewer 无法判定"该 catch 放在 wxLogin 内还是 createPersonalFamily 内"
  2. 若 catch 放在 createPersonalFamily（repo 层），则违反 repo 不处理业务语义的范式（userRepo.ts L11 "不处理业务语义"）
  3. 若 catch 放在 wxLogin（service 层），dispatch §2.1 B 代码应显式写出 try-catch 块
- **依据**：SOP-CARD-REVIEW §3 C2（DoD 可度量）+ C4（产出物具体）
- **修复建议**：
  1. 在 §2.1 B wxLogin 扩展代码中，`createPersonalFamily` 调用外层显式加 try-catch：
     ```typescript
     try {
       personalFamily = await familyRepo.createPersonalFamily({ ownerId: user.id, name: '我的账本' }, client);
     } catch (err) {
       if (isUniqueViolation(err, 'uq_families_one_personal_per_owner')) {
         personalFamily = await familyRepo.findPersonalFamily(user.id, client);
       } else {
         throw err;
       }
     }
     ```
  2. 补 `isUniqueViolation` 工具函数说明（pg error code `23505` · 参 sessionRepo 或其他已有范式）
  3. T6 测试期望改为：`createPersonalFamily 第二次抛 unique violation（error code 23505）→ wxLogin 内 catch → fallback findPersonalFamily → 返回首次创建的 family · 无报错`
- **FU 编号**：**FU-164-002**（D-016 强制 R1 修订）

### P1-3 OpenAPI /families/* 段（L161-319）无 x-deferred 标记 · dispatch 声明与事实不符

- **证据**：
  - dispatch §2.1 C L289："OpenAPI L161-308 `/families/*` 段保留 x-deferred 标记或不动（视现状）"
  - dispatch §3 DoD G8："x-deferred 不新增（本卡不引入新 deferred · /families REST 仍是 deferred 但不动它）"
  - dispatch §3 D-025 AP-003 扫描："AP-003 不命中（本卡不引入新 deferred · 也不清旧 deferred · /families REST 留 Sprint-4）"
  - 实际：`grep -n "deferred" server/api/openapi.yaml` 返回 **0 条匹配**——/families/* 段（L161-319）**完全没有 x-deferred 标记**
  - 这是 ADR-0007 §1.2 隐性技术债所引用的 "Sprint-2 Retro §议题 25 同款 OpenAPI vs 实装漂移反模式 AP-003"
- **问题**：
  1. dispatch 三处（§2.1 C / §3 G8 / §3 AP-003）声称 /families REST "仍是 deferred"——这是**虚假声明**，实际从未标记 deferred
  2. 此漂移正是 D-025 AP-003 定义的场景（"OpenAPI 已定义但 server 路由未实装 · 无 x-deferred 标记"）
  3. 本卡 dispatch 的 AP-003 "不命中"声明**不成立**——/families/* 段 L161-319 至少 6 个端点（GET/POST /families + GET/PATCH/DELETE /families/{id} + POST /families/{id}/invites + POST /families/invites/accept + DELETE /families/{id}/members/{uid}）均为无实装无标记的隐性漂移
- **依据**：D-025 AP-003（契约-实装漂移）+ SOP-CARD-REVIEW §3 C1（标题与描述）
- **修复建议**：
  1. dispatch §2.1 C 修正为："OpenAPI L161-319 `/families/*` 段**当前无 x-deferred 标记**（AP-003 隐性漂移 · Sprint-2 Retro §议题 25 同款）· 本卡不做 x-deferred 标记补齐（推 COSTRA-161 规则 E 或 Sprint-4 COSTRA-201 一并处理）· 不引入新 deferred · 也不清旧 deferred"
  2. dispatch §3 G8 修正为："x-deferred 不新增 · /families REST 当前无 x-deferred 标记（AP-003 已知漂移 · 非本卡范围）"
  3. dispatch §3 AP-003 扫描修正为："AP-003 **命中（已知隐性漂移）** · /families/* L161-319 共 6 端点无实装无 x-deferred · 本卡不动 · 推 COSTRA-161 规则 E 或 Sprint-4 补标 · 不引入新 deferred"
  4. 本条不阻塞 R1 实装（不改 /families/* 段 · 仅修正 dispatch 描述准确性）
- **FU 编号**：**FU-164-003**（D-016 强制 R1 修订 · 描述修正 · 不影响实装）

---

## P2 建议

### P2-1 DELETE /families kind=personal 拒绝路径：是否需本卡预埋 service 层守门接口

- **证据**：
  - dispatch §2.2 "DELETE /families → Sprint-4 COSTRA-201"
  - ADR-0007 §5.7.3："COSTRA-164：DELETE handler 不在本卡范围（无 /families REST · Sprint-4 落）· 但 **familyRepo.softDelete 接口加 kind 检查**（早期防御）"
  - dispatch §2.1 A familyRepo 接口列表中**没有 softDelete 接口**
- **问题**：ADR-0007 明确要求 164 的 familyRepo.softDelete 加 kind 检查，但 dispatch 的 familyRepo 接口定义中无此接口。若 165 调用方或未来代码误删 personal family，无 service 层守门
- **修复建议**：在 §2.1 A familyRepo 接口列表中补：
  ```typescript
  // 软删 family（仅允许 kind='shared' · kind='personal' 抛 AppError FAMILY_PERSONAL_NOT_DELETABLE）
  // ADR-0007 §5.7.3 早期防御
  export async function softDelete(input: { familyId: string; version: number }, client?: Runner): Promise<FamilyEntity>;
  ```
  若判断本卡确实不需要（无 REST 端点消费），至少在 §5.3 follow-up 中显式登记 `FU-164-FAMILY-SOFT-DELETE-KIND-GUARD` 由 COSTRA-201 一并落地
- **FU 编号**：**FU-164-004**

### P2-2 migration 0007 历史回填 ROW_NUMBER 排序确定性不够严谨

- **证据**：dispatch §2.1 A0 L101：`ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at ASC, id ASC) AS rn`
- **问题**：虽然 `created_at ASC, id ASC` 双字段排序在理论上保证了确定性（PG UUID v7 的 id 本身含时间序），但 dispatch 未说明为何不用 `id ASC` 单字段（UUID v7 单调递增 · 更简洁）。且 0006 migration 回填（L51）用的是 `ORDER BY updated_at ASC, id ASC`——两个 migration 的排序键不一致（created_at vs updated_at），可能造成回填结果在边缘情况下不同
- **修复建议**：
  1. 在 dispatch §2.1 A0 L101 补注释说明选择 `created_at` 而非 `updated_at` 的理由（"personal family 应按创建时间而非更新时间排序 · 更新时间可能因改名等操作晚于创建"）
  2. 或改为 `id ASC` 单字段（与 UUID v7 单调递增语义一致 · 更简洁 · 不依赖 created_at 列）
- **FU 编号**：**FU-164-005**

### P2-3 bootstrap 事务时延 < 30ms 预期缺基线 · runtime C8-3 维度未标注"未经验测"

- **证据**：
  - dispatch §7："bootstrap 事务时延：单事务 < 30ms 预期 · 若实测 > 100ms 需评估异步化"
  - D-022 v2.0 §2.2 C8-3："涉及微信 SDK 的纸面假设是否显式标注'未经验测'"——本卡虽是 server 端不涉及微信 SDK · 但 bootstrap 事务时延假设属于"纸面假设未实测"范畴
- **问题**：
  1. < 30ms 无任何实测基线（dev/staging/prod 数据库负载不同）· 属纸面假设
  2. D-022 C8-3 标注规则虽主要针对微信 SDK · 但其核心精神是"纸面假设显式标注未经验测"——本卡 bootstrap 时延假设应同等对待
- **修复建议**：dispatch §7 时延预期后补标注：`[未经验测] bootstrap 事务 < 30ms 为纸面预期 · PG 索引扫描 + 3 INSERT 实际时延需 staging 实测确认 · 若 > 100ms 评估异步化` · 与 D-022 §2.2 C8-3 合规示例格式对齐
- **FU 编号**：**FU-164-006**

---

## §AP-001/002/003 反模式扫描清单（D-025）

| AP | 命中 | 证据 / 否决理由 |
|---|---|---|
| AP-001（字符串代理判定） | 不命中 | 无业务字段字符串硬比较推断语义事实 · kind ENUM 是显式状态枚举非字符串代理 · personal/shared 由 DB ENUM + repo 强制赋值 · 非推断 |
| AP-002（概率极低就接受） | 不命中 | 多个 personal family 风险已通过 partial unique index 物理消除（非"概率低"接受）· race condition 通过 catch+fallback 自愈（非"概率低"接受）· 所有已知边界均有机制兜底 |
| AP-003（契约-实装漂移） | **命中 · 已知隐性漂移** | OpenAPI /families/* L161-319 共 6 端点无实装无 x-deferred · dispatch 三处虚假声称"仍是 deferred"· 实际从未标记 · 正是 D-025 AP-003 定义场景 · 本卡不动（推 COSTRA-161 规则 E 或 Sprint-4 补标）|

**结论**：命中 1 条 AP-003（已知隐性漂移 · P2 级 · 不阻塞 PASS-WITH-FOLLOWUP · 但 dispatch 描述必须修正——见 P1-3）

---

## 给卡作者的回执指令

请 backend-dev 按 P1 清单逐条修改 dispatch 定义：
1. **FU-164-001**：确认 withTx 复用 · 删除 transaction.ts 可写条目 · 统一函数名
2. **FU-164-002**：补 wxLogin try-catch unique violation + fallback 路径代码 · 对齐 T6 期望
3. **FU-164-003**：修正 /families/* x-deferred 虚假声明 · AP-003 扫描结论修正为"命中"

然后通过 Orchestrator 触发 Round 2 审核。

---

## 自我反思

- 审核耗时：约 35 分钟（含 16 份事实源全量 Read + 6 份交叉验证 grep）
- 置信度：高
  - withTx 存在性：物理 Read pool.ts L45-62 确认 ✓
  - x-deferred 缺失：`grep -n "deferred" openapi.yaml` 返回 0 匹配 ✓
  - ADR-0007 §5.7.3 softDelete 要求：Read ADR L279-281 确认 ✓
  - migration 范式对比：0006 L51 vs dispatch A0 L101 排序键差异确认 ✓
- 若低：建议 Orchestrator 转 Human 二裁（不需要 · 置信度高）
