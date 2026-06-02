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
> - `open-observation` — 观察项 · 不阻塞 · 等触发条件
> - `degraded-to-p3-observe` — 从原优先级降级为 P3 观察 · 留 Sprint+ 验证
>
> **隐性铁律**：Human 实测未通过前 FU 不真 closed（FU-LAUNCH 族 4 次定性翻转积累的硬约束）

---

## 📚 归档索引

- **Sprint-1 + Sprint-2 早期已闭合 FU**（18 条 · 含同族规约盲区 5 连 + FU-LAUNCH 族 4 卡 + FU-105-URL + 2026-05-13 维护批 4 条账本同步）→ [`_archive/follow-ups-closed-sprint-1.md`](../_archive/follow-ups-closed-sprint-1.md)
- 完整治理叙事（v1→v5 翻转链 / D-017 SOP 立案 / CI 对账族五代）原文亦在归档文件中

---

## 🟢 当前 open/scoped FU 速查表（2026-06-02 13:44 · `triage:sprint3-leftovers` 已同步）

| 主题族 | FU-ID | 优先级 | 候选卡 / 归属 | 状态 |
|---|---|---|---|---|
| **🆕 Sprint-3 末 Retro · 协议演化纪律** | **FU-PROTOCOL-VERSION-BUMP-CRITERIA** | **P1** | **Sprint-3 末 Retro 议题** | **open**（2026-05-22 · 触发：COSTRA-154 watermark 协议 v1.0 → v1.1 → v1.2 三连演化 · Sprint-3 末 Retro 议入：什么级别的 BUG 触发协议 v1.x → v2.x · 区别 doc-only sync（v1.x）与破坏性 schema 升级（v2.x）· 候选立规：协议字段类型变更 / 字段语义改写 / 时序模型替换 = v2.x · 仅文档同步 / 字段补全 / 注释澄清 = v1.x · 配套 sync-protocol.md §6 演化日志强制留 BREAKING/COMPAT 标记）|
| **🆕 Sprint-3 末 Retro · 分布式时序范式** | **FU-MICROSEC-VS-AUTOSEQ-PARADIGM** | **P1** | **Sprint-3 末 Retro 议题** | **open**（2026-05-22 · 触发：COSTRA-154 联合实测发现 watermark 微秒精度截断 · Human 追问"watermark 靠精度就一定能完美解决吗" · 暴露 3 类风险（同微秒并发 / NTP 回拨 / 主从切换）· 选项 B 升 BIGINT change_seq 自增序列号承担一致性 · `updated_at` 保留语义 · Sprint-3 末 Retro 议入：分布式系统 watermark / cursor / change tracking 的取舍范式（精度 vs 自增序列号 vs LSN/WAL pos）· 候选写入 ADR-0003 时序模型选型）|
| **🆕 Sprint-3 末 Retro · 测试基础设施** | **FU-PG-MEM-SHARED-HELPER** | **P2** | **Sprint-3 末 Retro 议题** | **open**（2026-05-22 · 触发：COSTRA-154 v1.2 实装时 `server/test/setup.ts` 内联 setval / timezone / to_char mock · 后续多卡复用需提取 · Sprint-3 末 Retro 议入：将 pg-mem 兼容层提取为公共 helper（`server/test/pg-mem-extensions.ts` 或类似）· 覆盖 SEQUENCE / setval / timezone 函数 / 字符串格式化函数 · 候选独立卡 P2 1pt）|
| **🆕 Sprint-3 末 Retro · 联合实测立意兑现** | **FU-JOINT-SMOKE-LAST-GATE-PARADIGM** | **P1** | **Sprint-3 末 Retro 议题** | **open**（2026-05-22 · 触发：COSTRA-154+150 联合 staging 实测捕获 P0 outbox 死锁 + P1 watermark 精度 · 单测 + curl + server 单测 30+ 全绿都漏不出 · D-024 §2.2 C1 立意首次得到协议升级级别证据 · Sprint-3 末 Retro 议入：联合实测 = 真闭环最后一道闸新范式 + R1.x.2 协议破坏性升级范式（vs 以往 R1.x.1 review-tech 修订型）· 候选规约：T2 卡 staging 实测前禁止 approve · 联合实测前禁止 R1 close · 配套 SOP-REVIEW v2.x §11 强化）|
| **Sprint-3 同步协议核心** | FU-104-SYNC-PULL | ~~P0~~ → **closed** | ~~COSTRA-154~~ | **closed @ COSTRA-154**（Human 已确认联合 smoke + Phase-3 prod 真机 PASS；v1.2 change_seq watermark 进入 Family First baseline）|
| **Sprint-3 同步协议核心** | FU-103-CLIENT-SYNC-SCHEDULER | ~~P1~~ → **closed** | ~~COSTRA-150~~ | **closed @ COSTRA-150**（Human 已确认联合 smoke + Phase-3 prod 真机 PASS；syncScheduler/outbox/v1.2 watermark 进入 Family First baseline）|
| **Sprint-3 同步协议核心** | FU-104-ENTRIES-PATCH | ~~P1~~ → **closed** | ~~COSTRA-152~~ | **closed @ COSTRA-152 R1**（PATCH /entries/{id} 实装 + cross-family guard fix + K3 method-override）|
| **Sprint-3 同步协议核心** | FU-104-ENTRIES-DELETE | ~~P1~~ → **closed** | ~~COSTRA-153~~ | **closed @ COSTRA-153 R1**（DELETE /entries/{id} 软删 + query ?version=N）|
| **Sprint-3 同步协议核心** | FU-103-CONFLICT-MERGE-UI | P2 | COSTRA-151 | **deferred-family-after-223**（`triage:sprint3-leftovers`：等 `221/222/223` 家庭协作闭环后重审 conflict UI dispatch）|
| **🆕 Sprint-3 family-context** | **FU-150-FAMILY-CONTEXT-SERVICE** | ~~P0~~ → **closed** | ~~COSTRA-164 + COSTRA-165~~ | **closed @ Family First baseline**（Human 已确认 `qa/current-stage-acceptance-family-first-baseline.md` PASS；family bootstrap/context 进入正式基线）|
| **🆕 Sprint-3 family-context** | **FU-165-GET-CONTEXT-ATOMIC** | **P3** | **Sprint-4 R2 family 切换器顺带** | **open**（2026-05-27 · 触发：COSTRA-165 R1 review-tech P2-1 · 现象：`miniprogram/services/family.ts:32-43` getActiveFamilyId/getActiveLedgerId 各自独立调 getItem · 理论上非原子 · 实际微信 storage 同步缓存底层无 I/O 竞争 · R1 风险极低 · 修复：R2 加 family 切换器时提供 `getActiveFamilyContext(): Promise<FamilyContext \| null>` 一次读取接口）|
| **🆕 Sprint-3 family-context** | **FU-165-DOWXLOGIN-RUNTIME-ANNOTATION** | **P3** | **下次 auth.ts 修订顺带** | **open**（2026-05-27 · 触发：COSTRA-165 R1 review-tech P2-2 · 现象：`miniprogram/services/auth.ts:238-247` doWxLogin 真实链路 setActiveFamily + globalData 同步写入缺 `[未经验测]` 标注 · 与 syncScheduler.ts:99 标注范式不一致 · 修复：加 `// [未经验测]（D-022 C8-3）: storage 写入后跨页面读取依赖微信 storage 实现 · 需真机验证` 注释）|
| **🆕 Sprint-3 错误码同步** | **FU-164-OPENAPI-ERRORCODE-ENUM** | **P2** | **COSTRA-221**（Sprint-4 家庭管理 API · DELETE/成员/家庭管理口径一并修） | **open**（2026-05-27 · 触发：COSTRA-164 R1 review-tech P2-3 + R1.x review-tech P2-1 双轮登记 · 现象：`server/api/openapi.yaml` `components.schemas.ErrorCode` enum 列表中未包含 `FAMILY_PERSONAL_NOT_DELETABLE`（R1.x 已同步 docs/api/error-codes.md §2.3 + §4.1 · 但 openapi.yaml 留遗）· ErrorCode.ts §0.2 约束"新增 code 必须同步 openapi.yaml" · 推荐 COSTRA-221 落家庭管理 API 时一并补齐 enum · 影响：客户端类型生成可能漏映射 · 当前 server 端逻辑路径已正确 throw 此 code · 影响仅限契约文档完整性）|
| **🆕 Sprint-3 auth refresh** | **FU-164-REFRESH-DEFAULT-IDS-NULL** | **P2** | **COSTRA-221 或 auth hardening 批** | **open**（2026-05-27 · 触发：COSTRA-164 R1 review-tech P2-2 + R1.x review-tech P2-2 双轮登记 · 现象：`server/src/services/authService.ts:257-266` refresh 路径中 · 若 `findPersonalFamily` 返回 null（理论上不应发生 · 极边缘数据异常）· `defaultFamilyId` / `defaultLedgerId` 保持空字符串 `''` · 而 OpenAPI AuthTokenPair schema 声明这两字段为 `format: uuid` + `required` · 修复方向：refresh 路径若 personal family 缺失 → 走 wxLogin 同款 bootstrap 自愈 或 throw UNAVAILABLE · 不应返回空字符串 · 影响：极边缘 · 当前 bootstrap 事务保证 wxLogin 路径必非空 · 仅 refresh 路径在数据异常时存在合约违反风险）|
| **🆕 Sprint-3 末 Retro · pg-mem 限制** | **FU-PG-MEM-PARTIAL-INDEX-ENUM-LIMIT** | **P3** | **Sprint-3 末 Retro 议题** | **open**（2026-05-27 · 触发：COSTRA-164 R1.x T10 ④ shared family 删除路径降级到 staging · 根因：pg-mem 在 partial unique index `WHERE kind='personal'` 含 ENUM 列时索引覆盖范围误判 · 导致 shared family INSERT 后 SELECT 返 0 行 · 真 PG 行为正常 · 测试已加 `[C8-3 pg-mem 已知 bug]` 注释 + 显式登记 FU · Sprint-3 末 Retro 议入：① 评估迁移测试基础设施到 testcontainers + 真 PG（解决 pg-mem 多个限制：partial index + ENUM / setval / timezone / ROLLBACK 不完整 / constraint 名缺失等）· ② 候选合并 FU-PG-MEM-SHARED-HELPER P2 议题 · ③ 决策点：是否 Sprint-4+ 立卡迁移 pg-mem → testcontainers · 受 Sprint-3 retro 议入 P0/P1 议题数量影响）|
| **🆕 Sprint-4 guardrail · sync 字段映射** | **FU-220-SYNC-USER-ID-CREATED-BY** | **P1** | **Sprint-4 guardrail**（backend-dev + miniapp-dev） | **scoped-sprint-4-guardrail**（2026-06-02 · 触发：`COSTRA-220` T3 review P1 · sync wire `user_id` 与本地 Entry `created_by` 不对齐，`applyServerChanges` 未映射，影响 sync pull 条目的“仅看自己”筛选）|
| **🆕 Family members · 退出成员快照** | **FU-221-MEMBER-SNAPSHOT-ON-LEFT** | **P2** | **Sprint-5+ / COSTRA-223 后观察** | **open-observation**（2026-06-02 · 触发：`COSTRA-221` card-review R1 P2 · R1 不给 `family_members` 加 nickname/avatar snapshot，先 JOIN users；若家庭页灰化退出成员要求展示退出时快照，再补 migration）|
| **🆕 Family API · 测试补强** | **FU-221-PATCH-VERSION-CONFLICT-TEST** | **P2** | **Sprint-4+ 测试补强** | **open**（2026-06-02 · 触发：`COSTRA-221` review-tech R1 P2 · DELETE family 已覆盖 version conflict，PATCH family 过期 version → 409 建议补独立测试）|
| **🆕 Family API · service 拆分观察** | **FU-221-FAMILY-SERVICE-SPLIT** | **P2** | **Sprint-4+ 工程债观察** | **open-observation**（2026-06-02 · 触发：`COSTRA-221` review-tech R1 P2 · `familyService.ts` 约 412 行，后续 invite/member 逻辑增长时考虑拆 `familyInviteService.ts`）|
| **Epic-A 用户资料**（→ COSTRA-157 合卡）| FU-001 | P2 | COSTRA-157 | scoped |
| **Epic-A 用户资料**（→ COSTRA-157 合卡）| FU-118-2 | P2 | COSTRA-157 | scoped |
| **Epic-A 用户资料** | FU-102-PROFILE-REFUSE-UI | ~~P1~~ → **closed** | ~~COSTRA-158~~ | **closed @ COSTRA-158** |
| **Epic-A 用户资料**（→ COSTRA-157 合卡）| FU-102-ERROR-MAPPER-INTEGRATION | **P1** | COSTRA-157 | scoped |
| **Epic-A 用户资料**（→ COSTRA-157 合卡）| FU-102-AVATAR-ONERROR | **P1** | COSTRA-157 | scoped |
| **DevOps 基建** | FU-118-3（→ COSTRA-160）| P0 根因 / P2 优先级 | COSTRA-160（已立卡）| open |
| **DevOps 基建** | FU-CI-MP-BUILD-NPM-ENFORCE | P2 | Sprint-2 CI 升级 | open |
| **DevOps 基建** | FU-LIBVERSION-DEV-GUARD | P3 | Sprint-2 候选 | open |
| **DevOps 基建** | FU-118-5 | P2 | 合 COSTRA-903 APM | open |
| **DevOps 基建** | FU-118-4 | P2 | Sprint-2 末维护批 | open |
| **DevOps 基建** | FU-DEVOPS-NGINX-ICP-HEADER | P3 | DNS+SSL+反代上线触发 | open-observation |
| **DevOps 基建** | FU-DEVOPS-ICP-HEALTH-PROBE | P2 | 合 COSTRA-903 APM | open |
| **DevOps 基建** | **FU-DEVOPS-ICP-CROSS-SSOT-CHECK** | **P2** | **COSTRA-163** | **scoped-sprint-4-guardrail**（`triage:sprint3-leftovers`：与 161 同节奏批 · whitelist-check.mjs 升级双卡）|
| **DevOps 基建** | **FU-DEVOPS-OPENAPI-IMPL-COVERAGE** | **P2** | **COSTRA-161** | **scoped-sprint-4-guardrail**（`triage:sprint3-leftovers`：D-025 AP-003 自动检测 · 启动前需重审 x-deferred / `/families/*` 策略）|
| **DevOps 基建** | **FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE** | **P3** | **COSTRA-162** | **deferred-p3**（`triage:sprint3-leftovers`：Phase-3 prod 真链路已过，不抢 Family First 主线）|
| **DB 治理** | FU-DB-OPS-AUDIT | P3 | DAU>100 触发 | open |
| **🆕 Auth / 安全** | **FU-AUTH-ROTATING-REFRESH** | **P2** | **Sprint-4+ 认领** | **open**（2026-05-25 · 触发：Human 与 Orchestrator 复盘 JWT 双 token 方案时确认当前 MVP 为「不轮换」refresh · 见 `server/src/services/authService.ts:172` 注释 + `0003_user_sessions.sql:13`「MVP 不换发」+ `docs/api/ttl-policy.md §7` 已列入调优空间 · 范围：① refresh 时签新 refresh + 原子吊销旧 jti（UPDATE…RETURNING + 同事务 INSERT）② 重用检测（已 revoked 的 refresh 再次出现 → revokeAllByUser + 审计告警 · OAuth 2.1 §6.1）③ 可选 `version` / `rotated_from` 列防双花 · 主改面：`server/src/services/authService.ts` refresh() + `server/src/repositories/sessionRepo.ts` 新增原子轮换 SQL · DB 视方案需新加一列 · 测试要覆盖：并发 refresh 仅一份成功 / 旧 refresh 重用触发全量吊销 / logout-vs-refresh 竞态 · 触发立卡的考虑阈值：用户量级上来 / 安全审计要求 / Sprint-4+ 认证强化批 · 不阻当前任何卡）|
| **协议 / 规约残留** | FU-COMMON-MINIAPP-PATCH-LIMIT | ~~P2~~ → **closed** | ~~COSTRA-158~~ | **closed @ COSTRA-158** |
| **协议 / 规约残留** | **FU-K3-TO-K1-UPGRADE** | **P2** | **COSTRA-152** | scoped（dispatch §1.3 阶段决策 · COSTRA-152 Card-Review 阶段拍板 · R1 K3 已落地 · Sprint-4 评估 K1）|
| **🆕 跨 family 守门补丁** | **FU-CROSS-FAMILY-GUARD-COSTRA-104** | ~~P0~~ → **closed** | **COSTRA-152 R1** | **closed @ COSTRA-152 R1**（entryRepo.findById +userId 参数 + entryService.findById 传入 userId · GET/PATCH/DELETE 三处共享守门 · review-tech 36/40 漏检反思议入 Sprint-3 末 Retro）|
| **QA 自动化** | FU-105-AUTOMATION-FULL-COVERAGE | P2 | **COSTRA-155** | **scoped-sprint-4-guardrail / needs-redispatch**（`triage:sprint3-leftovers`：原 automator+CI 范围需拆基线逻辑回归网 / Family E2E / runner 决策）|
| **QA 自动化** | FU-156-OUTBOX-FLAKY | P2 | **COSTRA-159** | **scoped-sprint-4-optional**（`triage:sprint3-leftovers`：等 outbox flaky 复现或 CI 化前降噪时启动）|
| **外部触发** | FU-115-2 | O 观察 | Human ICP 下证日触发 | open |
| **🆕 QA 实测发现（族 H）** | ~~BUG-105-D1-LEDGER-ID-DEFAULT~~ | ~~🔴 P0~~ → **closed** | ~~COSTRA-105 R1.x.1~~ | **closed @ commit 33dbdea** |
| **🆕 QA 实测发现（族 H）** | ~~BUG-156-SYNC-PUSH-PAYLOAD-NO-UUID-VALIDATION~~ | ~~🔴 P0~~ → **closed** | ~~COSTRA-105 R1.x.2~~ | **closed @ commit db488b9** |
| **🆕 QA 实测发现（族 H）** | FU-105-DEV-CONSOLE-HOOK | P3 | Sprint-3 头部 miniapp-dev（合 COSTRA-150 顺带 / 或独立小卡）| open |
| **🆕 Orchestrator 自检** | **FU-ORCH-FACT-CHECK-DISCIPLINE** | **P1** | **Sprint-3 末 Retro 议题** | **open**（2026-05-22 · Orchestrator 给 Human 写实测手册时凭印象写命令导致 3 处事实错误：① healthz 路径加了 /v1（实际根路径 · app.ts:69 注释明示）② DB 名错为 costra_dev（实际 costra · .env:12）③ families INSERT 模板缺 owner_id 列（实际有 · 0001_init.sql:32）· **D-025 AP-001 字符串代理判定反例第 1 次 Orchestrator 自身命中**（之前 158 第 1 次正向规避 · 154 第 1 次正向兑现 AP-003 · 此次 AP-001 反例命中需立强约束）· Human 反馈批评 → spawn qa-planner 装扮档归口产出严谨手册（commit `95a9a11` · 707 行 · 每条命令均标 Read 验证事实源）· Retro 候选议题：Orchestrator 给 Human 写「执行类文档」（实测手册 / SQL 模板 / 命令清单等）必须 ≥ N 文件 Read 后再写 · 不能凭装扮档过往交付的印象代理 · 候选立强约束：Orchestrator 写 Human 操作类文档前强制走 spawn 装扮档归口产出 · 而非 Orchestrator 直写）|

> **2026-05-27 17:30 COSTRA-165 R1 APPROVE 38/40 · 双卡联立完成 · 等 Human 联合实测**：
> - **R1 实装 commit** `3472864`：family.ts 新建 + auth.ts 5 处接入 + syncScheduler 委托 + entry 防御 + 11 测全绿 + 反向验证 ④ 全过
> - **review-tech R1 APPROVE 38/40**：D-022 v2.0 一轮过 · 0 P0 / 0 P1 / 2 P2 · D-025 三项反模式 0 命中 · TokenRaw ↔ AuthTokenPair 14/14 字段对齐
> - **D-016 第 14 次实战合规** · 双卡范式（164 R1.x + 165 R1 = 双 38/40 APPROVE）
> - **追加 2 条 FU**：
>   - **FU-165-GET-CONTEXT-ATOMIC**（P3 · Sprint-4 R2）：getActiveFamilyContext 一次读取接口（双读原子性）
>   - **FU-165-DOWXLOGIN-RUNTIME-ANNOTATION**（P3 · 下次 auth.ts 修订顺带）：doWxLogin 真实链路补 `[未经验测]` 标注
> - **下一步**：Human 联合 164+165 staging 实测 4 场景 → 双卡 approve → FU-150-FAMILY-CONTEXT-SERVICE 真 closed → spawn qa-planner 出新版 Phase-3 实测手册（dispatch v1.1 §8 触发条件）

> **2026-05-27 15:30 COSTRA-164 R1.x APPROVE 38/40 · 追加 3 条 FU**：
> - **R1 → R1.x 演进**：R1 commit `2e71dc8` PASS-WITH-FOLLOWUP 35/40（0 P0 / 3 P1 / 3 P2）→ R1.x 修订 commit `8c8cdce` 同轮兑现 3 P1 → R1.x 形式审 commit (待) APPROVE 38/40（0 P0 / 0 P1 / 2 P2）· D-016 100% 修订率铁律第 13 次实战合规 · 80/80 测全绿 · typecheck 0 error
> - **3 P1 兑现实证**：① P1-1 docs/api/error-codes.md 字典 21→22 · ② T6 constraint 双校验断言 + [C8-3] 标注 · ③ familyRepo.softDelete ownerId 守门双重防御（SELECT + UPDATE WHERE owner_id）· Sprint-2 retro 议题候选 5（service 层 user/family 守门）实战兑现
> - **追加 3 条 FU**：
>   - **FU-164-OPENAPI-ERRORCODE-ENUM**（P2 · 推 COSTRA-221；原 COSTRA-201 家庭卡号已重映射）：openapi.yaml ErrorCode enum 补 FAMILY_PERSONAL_NOT_DELETABLE
>   - **FU-164-REFRESH-DEFAULT-IDS-NULL**（P2 · 推 COSTRA-165 或 201）：refresh 路径 default_family_id 空字符串风险
>   - **FU-PG-MEM-PARTIAL-INDEX-ENUM-LIMIT**（P3 · Sprint-3 末 Retro 议题）：pg-mem partial unique index + ENUM 列已知 bug · T10 ④ 降级 staging
> - **下一步**：spawn miniapp-dev 做 COSTRA-165 R1 实装（family-context service）· 联合实测 + 双卡 approve 后真 close FU-150-FAMILY-CONTEXT-SERVICE

> **2026-05-27 family-context 决策落档（ADR-0007 + 双卡）**：
> - **根因**：COSTRA-150 R1 卡审 P0-1 留下的 FU-150-FAMILY-CONTEXT-SERVICE · 是 Phase-3 真机实测阻塞的根本原因（client 拿不到 family_id/ledger_id · 实测手册让 Human 手动 SSH+Console 注入是临时绕过非产品形态）
> - **决策方法**：Human + Orchestrator 4 轮选项收敛（X 单容器 → P ledger 共享开关 → Q 汇总层 → R user 多 family）· 最终采纳 Human 提议的方案 R · 落档 [`ADR-0007 family-ledger 关系模型`](../decisions/ADR-0007-family-ledger-relation-model.md) v1.0
> - **方案 R 核心**：user 多 family（应用层上限默认 3 · 后端硬上限 20 · 配置可调）· family:ledger=1:1 产品语义（schema 物理 1:N 保留扩展空间）· 单人时透明建"我的账本"个人 family · 加入家庭=新建 family + 可选复制旧数据（INSERT...SELECT · 同步 + 进度条 · 用户接受延迟）· 个人 family 永远独立保留（解决退出 / 隐私 / 撤回三大痛点）
> - **R1 双卡 dispatch 落档**：COSTRA-164 server family bootstrap MVP（3pt · backend-dev）+ COSTRA-165 miniapp family-context service（2pt · miniapp-dev · 强依赖 164 R1 APPROVE）· 联立攒批 D-024 §2.2 C1 联合 approve 范式
> - **R2/Sprint-4 锚定（已重映射）**：COSTRA-221/223 邀请流程 + 加入向导（含复制选项）· R3/Sprint-5+ 选择性导入 / 异步 / 私密 ledger
> - **schema 改动量**：R1 = 0（ADR-0007 §4.1 锚定 · 现有 schema families/ledgers/family_members 已天然支持方案 R）

> **2026-05-19 20:50 Sprint-3 启动批量整理**：
> - COSTRA-154 R1 实装完成（commit `7e87bad` + R1.x.1 修订 commit `8eecd4c` · review-tech APPROVE 38/40）· FU-104-SYNC-PULL 闭合
> - **8 张 follow-up 转正立卡 dispatch**：COSTRA-150 + 152 + 153 + 151 + 155 + 159 + 161 + 162 + 163（含 154 已闭合）· 估点合计约 27 点 · Sprint-3 估点目标 30~36 含 buffer
> - 转正路径：FU-103-CLIENT-SYNC-SCHEDULER → COSTRA-150 · FU-104-ENTRIES-PATCH → COSTRA-152 · FU-104-ENTRIES-DELETE → COSTRA-153 · FU-103-CONFLICT-MERGE-UI → COSTRA-151 · FU-105-AUTOMATION-FULL-COVERAGE → COSTRA-155 · FU-156-OUTBOX-FLAKY → COSTRA-159 · FU-DEVOPS-OPENAPI-IMPL-COVERAGE → COSTRA-161 · FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE → COSTRA-162 · FU-DEVOPS-ICP-CROSS-SSOT-CHECK → COSTRA-163

> **2026-05-19 14:50 同步整理**：
> - **微信白名单已配**（Human 完成 `https://costra.cloud` 4 类全填 · 即时生效 · D-023 §7 #1 解锁）→ 解锁 105 方式 C 真链路实测 + Sprint-3 154/152/153 staging 验证
> - **公安联网备案已提交**（Human 完成 @ 2026-05-19 · 在 30 日窗口内 · 详见 `docs/legal/compliance-registry.md §4` · R-019 🟠→🟡 Submitted）
> - **过期 P0 BUG 标注 cleanup**：BUG-105-D1-LEDGER-ID-DEFAULT @ commit `33dbdea` + BUG-156-SYNC-PUSH-PAYLOAD-NO-UUID-VALIDATION @ commit `db488b9` · 两 BUG 早已修但 README 没同步 closed 标注 · 同步落档

> **2026-05-19 COSTRA-158 同步关闭 2 条 FU**：FU-COMMON-MINIAPP-PATCH-LIMIT（server PATCH route 实装 + K3 method-override 兼容 · client 降级链路验证可用）· FU-102-PROFILE-REFUSE-UI boundary risk 子项（COSTRA-157 间接判定 → 158 严格 has_completed_profile 字段判定）

---

## 登记列表（按主题族分组）

---

## 🚀 族 A · Sprint-3 同步协议核心（5 条 · 强联动 · 必须打包做）

### FU-104-SYNC-PULL · GET /sync/pull 增量拉取实装（替代 R1 stub 501 · PRD AC-4 核心）

- **来源**：2026-05-11 14:00 COSTRA-104 R1 切出去铁律（dispatch §2.2 · Q1.2 拍板 3 张独立卡）
- **登记时间**：2026-05-11
- **范围**：实装 `GET /sync/pull?since=<watermark>&limit=N` · 返回增量 changes + 新 watermark · 协议 §3 + §6.3 · 客户端 db.ts setWatermark 落 storage
- **协议事实源**：`server/api/openapi.yaml` paths /sync/pull + `docs/api/sync-protocol.md` §3 + §6.3
- **依赖**：COSTRA-104 R1 已实装 entries 表 + audit_logs 表（watermark 推进基础）
- **PRD 锚点**：PRD AC-4「无网也能保存 → 写入本地队列 → 联网后自动上传 + 多设备增量同步」
- **阻断级别**：**P0**（PRD 核心承诺 + FU-103 调度器无 pull 即 client watermark 永远空）
- **认领建议**：Sprint-3 头部（COSTRA-154 · 估 5 点 · **与 COSTRA-150 client 调度器一同做才有意义**）
- **状态**：`closed @ COSTRA-154` `7e87bad`（R1 commit 替代 stub 501 · GET /sync/pull 增量拉取实装）
- **owner_card**：COSTRA-154（已实装 · commit `7e87bad`）

### FU-103-CLIENT-SYNC-SCHEDULER · client 端同步调度器（onShow / 网络恢复 / 周期 / 启动触发 pushDelta + syncPull）

- **来源**：2026-05-09 19:05 Human 模拟器实测 COSTRA-103 R1 步骤 D（无 POST）+ 步骤 E（watermark 空 · `keys.filter(k => k.startsWith('watermark:'))` = `[]`）
- **登记时间**：2026-05-09 19:10（COSTRA-103 R1 Tech APPROVE 后同手册修订一并登记）
- **范围**：
  - **触发时机**：① `App.onLaunch` / `Page.onShow` ② `wx.onNetworkStatusChange isConnected:true` ③ 周期 setInterval（10s · 兑现 PRD「联网 10s 自动推送」）④ 用户主动下拉刷新
  - **调度 API**：`pushDelta()`（已实装 · `miniprogram/services/sync.ts:74`）+ `syncPull(family_id, since)`（已实装 · `miniprogram/services/sync.ts:43`）+ push/pull 互斥锁（协议 §6.1）
  - **观测**：watermark 落到 storage `watermark:{family_id}` key · `entry:__index` 在 server 推送 changes 后被 `applyServerChanges` 同步
  - **兜底**：网络失败 catch → outbox 整批留 + idempotency_key 不变 + 下次重试（已实装）
- **依赖**：
  - **必须**：COSTRA-104（server `/sync/push` + `/sync/pull` 端点 + ErrorCode + idempotency_keys 实装稳定）
  - **建议**：COSTRA-103 R1 已落 syncPush/syncPull 函数体（不接调度器）· 本 FU 仅补"调度器"层（即 onShow/onNetworkStatusChange/setInterval 的 wire-up）
- **PRD 锚点**：
  - PRD AC-4：「无网也能保存 → 写入本地队列 → 联网后自动上传」
  - sync-protocol.md §6.1：push/pull 互斥锁
  - sync-protocol.md §6.3：watermark 单调推进
- **阻断级别**：P1（PRD 核心承诺 · 当前由 R1 dispatch 明示推迟 · 不阻 COSTRA-103 R1 终审）
- **认领建议**：Sprint-3 头部（COSTRA-104 server 稳定后立卡 · 估 5 点 · 候选卡号 COSTRA-150）
- **状态**：`closed @ COSTRA-150` `ee97a7a`（R1 实装 · 4 触发源调度器 · pushDelta+syncPull 复用）
- **owner_card**：COSTRA-150
- **不阻塞 COSTRA-103 终审依据**：D-022 v2.0 评分表 38/40 APPROVE · Human 实测 5 步 + 5 硬断言全 PASS（H1 sync API 0 / H2 outbox 多 key / H3 snake_case / H4 client_ref_id 持久 / H5 ensureVersion + lib 3.8+）· R1 dispatch §2 明示"COSTRA-104 接调度器"

### FU-104-ENTRIES-PATCH · PATCH /entries/{entry_id} 实装（替代 R1 stub 501）

- **来源**：2026-05-11 14:00 COSTRA-104 R1 切出去铁律（dispatch §2.2 · Q1.2 拍板 3 张独立卡）
- **范围**：实装 `PATCH /entries/{entry_id}` 端点 · 支持部分字段更新（amount/note/category_id/...）+ 乐观锁（base_version 头部）+ 触发 outbox 同步 · 替代 R1 stub 501
- **协议事实源**：`server/api/openapi.yaml` paths /entries/{entry_id} PATCH 完整定义 + EntryUpdate schema
- **依赖**：COSTRA-104 R1 已实装 entryService（findById/optimisticUpdate 工具方法可复用）
- **PRD 锚点**：用户记一笔后修改场景 · 高频
- **阻断级别**：~~P1~~ → **closed**
- **认领建议**：✅ **已由 COSTRA-152 R1 闭环**（PATCH /entries/{id} 实装 + K3 method-override + cross-family guard fix）
- **状态**：`closed @ COSTRA-152 R1`
- **owner_card**：COSTRA-152（已实装）

### FU-104-ENTRIES-DELETE · DELETE /entries/{entry_id} 软删实装（替代 R1 stub 501）

- **来源**：同 FU-104-ENTRIES-PATCH
- **范围**：实装 `DELETE /entries/{entry_id}` 端点 · 软删（设 `deleted_at` 列）+ 触发 outbox 同步删除事件 · 客户端 syncPull 时收到 deleted_at 不为空的 entry 后从 db 移除
- **协议事实源**：`server/api/openapi.yaml` paths /entries/{entry_id} DELETE
- **依赖**：COSTRA-104 R1 已建表 entries.deleted_at 列 + entryService 已有 softDelete 工具方法（部分实装）
- **阻断级别**：~~P1~~ → **closed**
- **认领建议**：✅ **已由 COSTRA-153 R1 闭环**（DELETE /entries/{id} 软删 + query ?version=N）
- **状态**：`closed @ COSTRA-153 R1`
- **owner_card**：COSTRA-153（已实装）

### FU-103-CONFLICT-MERGE-UI · 真实 conflict 合并 UI（替代 R1 mergeIntoConflictQueue 桩）

- **来源**：2026-05-09 同 FU-103-CLIENT-SYNC-SCHEDULER 同根因（PRD AC-4 离线优先架构最后一公里）
- **登记时间**：2026-05-09 19:10
- **范围**：
  - 替换 `miniprogram/services/outbox.ts` 当前的"立即重试 next_retry_at = now+1"消极策略（仅 R1 桩）
  - 实装真实合并 UI：`mergeIntoConflictQueue(op, server_state)` → 用户可视化 server 版本 vs client 版本 → 三选一（保留服务端 / 保留客户端 / 手动合并）
  - 协议对齐：sync-protocol.md §2.4「conflict → 保留 dirty + 等待合并」+ conflict-strategy.md（待 Sprint-3 立案）
- **依赖**：
  - **必须**：COSTRA-104 server `/sync/push` 返回 `conflict` 状态 + server_state payload
  - **建议**：FU-103-CLIENT-SYNC-SCHEDULER 已上线（让 conflict 真实在生产环境出现）
- **PRD 锚点**：
  - PRD AC-3 转账冲突场景（家庭模式下父母同时改一笔）
  - sync-protocol.md §2.4
- **阻断级别**：P2（家庭模式才会触发 · MVP 单人记账暂不阻断 · Sprint-3+ 落地）
- **认领建议**：Sprint-3 中后段（候选卡号 COSTRA-151 · 估 5 点 · 与 conflict-strategy.md 决议立案捆绑）
- **状态**：`open`
- **owner_card**：COSTRA-151（待 Sprint-3 Planning 认领）

---

## 👤 族 B · Epic-A 用户资料完善（5 条 · 已合卡到 COSTRA-157 · 等 Card-Review R1）

> **2026-05-18 状态流转**：Human all-A 决策 · 5 条 FU 合并到 **COSTRA-157**（3 点 · miniapp-dev + backend-dev 单卡双装扮档）· dispatch 已落盘 [`.team/dispatch/COSTRA-157-user-profile-completion-and-login-resilience.md`](../dispatch/COSTRA-157-user-profile-completion-and-login-resilience.md) · 等 Card-Review R1 启动 D-014-a 流程

### FU-001 · 业务占位昵称配置化

- **来源**：`.team/reviews/COSTRA-101/round-1-tech.md` P2-1
- **登记时间**：2026-04-24 11:50（COSTRA-101 Round 1 Revise）
- **范围**：`server/src/services/authService.ts` wxLogin 路径里的硬编码 `nickname: '微信用户'`
- **建议**：抽到 `server/src/config/defaults.ts` 导出 `defaultNickname`，支持 env 覆盖 + subjectConfig 语境化
- **阻断级别**：P2（不阻当卡 · 登录链路业务可用）
- **认领建议**：✅ **已合入 COSTRA-157**（A 项 server defaults · Q2-A 硬编码 fallback · 不引入 env 覆盖）
- **状态**：`scoped`
- **owner_card**：**COSTRA-157**（dispatch 已落盘 · 等 Card-Review R1）
- **同类拓展**：FU-118-2（miniprogram 端 "未命名用户"）· 已合并处理

### FU-118-2 · miniprogram 端硬编码昵称 "未命名用户"

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-2
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/pages/mine/index.ts:39` + `miniprogram/pages/home/index.ts:62`（hydrateUser 兜底也走同一字符串）
- **建议**：与 FU-001 合并处理（server 与 miniprogram 两端同时改）· 新建 `miniprogram/config/defaults.ts` 与 server 端对齐
- **阻断级别**：P2
- **认领建议**：✅ **已合入 COSTRA-157**（B 项 miniapp defaults）
- **状态**：`scoped`
- **owner_card**：**COSTRA-157**

### FU-102-PROFILE-REFUSE-UI · 用户拒绝 getUserProfile 的空窗期 UI 状态

- **来源**：`.team/reviews/COSTRA-102/round-1-product.md` P2-NEW-1
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/login/index.ts` 调 `wx.getUserProfile` 被用户取消授权时的 home 页空头像空昵称降级显示策略
- **建议**：home 页显示占位头像 + "欢迎" 无名称版本 + 页面角标"完善资料"入口
- **阻断级别**：原 P2 → **升级 P1**（2026-05-19 09:42 Human 否决"概率极低"接受边界）
- **认领建议**：
  - 🟡 COSTRA-157 R1 已实装"基于 nickname 字符串比较的代理判定"（u.nickname !== defaultNickname）· 完成边界 + Q5-A 临时文字链入口 · 但 Human 否决概率近似判定
  - ✅ **已由 COSTRA-158 闭环**（has_completed_profile 严格字段判定 · 替换 157 间接判定）
- **状态**：`closed @ COSTRA-158`（boundary risk 子项 · 157 间接判定 → 158 严格 has_completed_profile）
- **owner_card**：~~COSTRA-158~~（已闭环）
- **🆕 2026-05-19 09:42 Human 否决记录**：`u.nickname !== defaultNickname` 是字符串代理判定 · 不是事实判定 · 用户名='微信用户'撞库时误判 → 不能用"概率极低"理由接受 → 立 COSTRA-158 走严格事实字段（has_completed_profile）
- **🆕 2026-05-19 COSTRA-158 闭环**：server has_completed_profile 字段 + client computeHasProfile 严格判定 + auth.updateLocalUserProfile 本地同步 · 157 间接判定已完全替换

### FU-102-ERROR-MAPPER-INTEGRATION · login 页错误分支直出 err.message 违反红线

- **来源**：`.team/reviews/COSTRA-102/round-1-tech.md` P1-NEW-1 + `round-1-product.md` P1-NEW-1（双签方共识）
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/login/index.ts:87-97` 错误分支 `msg = e.message`（line 94-96）违反 `docs/api/error-codes.md §0.5` 红线"客户端不得直接展示 message 给终端用户"· 实际渲染路径是 `setData({ errMsg: msg })` 到模板（不是 toast）
- **建议**：改为 `import { mapError } from '../../utils/error-mapper'; const m = mapError(e); setData({ errMsg: m.title ? \`${m.title}：${m.desc}\` : '登录失败，请重试' })`
- **阻断级别**：**P1**（红线违反 · 双签方均判非阻塞 · 但应优先清掉）
- **认领建议**：✅ **已合入 COSTRA-157**（C 项 mapError 改造）
- **状态**：`scoped`
- **owner_card**：**COSTRA-157**

### FU-102-AVATAR-ONERROR · home.wxml binderror 对应 handler 未实现

- **来源**：`.team/reviews/COSTRA-102/round-1-tech.md` P1-NEW-2
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/home/index.wxml:5` `<image binderror="onAvatarError">` 已存在 · `index.ts` 无 `onAvatarError` 方法 · 头像 404 时无 fallback 触发
- **建议**：补 `onAvatarError(): void { this.setData({ userAvatar: '' }) }` 走 wxml `wx:if` fallback 切换到 👤 占位
- **阻断级别**：P1（功能非致命 · 头像 URL 不达静默失败）
- **认领建议**：✅ **已合入 COSTRA-157**（D 项 onAvatarError handler）
- **状态**：`scoped`
- **owner_card**：**COSTRA-157**

---

## 🔧 族 C · DevOps 基建 / CI 升级（5 条）

### FU-118-3 · miniprogram/tokens.json 未被任何 wxss 消费（设计-实装脱节 · → COSTRA-160）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P0-9 根因分析
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/tokens/index.ts` 正确导出 colors/shadows/radii，但 `app.wxss` 与各页面 wxss 全部用手写 CSS 变量 · 两套完全脱节
- **建议**：Sprint-2 独立专项卡"设计系统 miniprogram 侧闭环"
  - 方案：写构建脚本 `scripts/gen-wxss-tokens.mjs` · 从 `tokens.json` 自动生成 `app.wxss` 的 `:root {}` 段
  - 副产品：保证所有页面引用的变量名都在 token 真身内
- **阻断级别**：P0 根因（本卡 P0-9 的深层修复）· 但本卡采用快修方案 A（手动补齐 app.wxss）· 彻底方案 B 延到 Sprint-2
- **认领建议**：**Sprint-2 新立 COSTRA-160** `miniapp-design-tokens-pipeline`（已在 backlog.json 占位）
- **状态**：`open`
- **owner_card**：COSTRA-160

### FU-118-5 · miniprogram 关键路径 console.* 统一日志封装

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-4
- **登记时间**：2026-04-24 19:35
- **范围**：app.ts × 3 + services/auth.ts × 4 + services/storage.ts × 3 + services/request.ts × 1 = 11 处 `console.*`
- **建议**：Sprint-2 引入统一 logger 封装
  - 方案 A：`utils/logger.ts` 包装 `wx.getRealtimeLogManager()`（微信官方实时日志）+ ring buffer
  - 方案 B：上报到后端 APM（依赖 COSTRA-903）
- **阻断级别**：P2
- **认领建议**：Sprint-2 与 APM 卡（COSTRA-903）合入
- **状态**：`open`

### FU-CI-MP-BUILD-NPM-ENFORCE · CI 引入 miniprogram-ci 真实编译冒烟

- **来源**：COSTRA-123 收官时 Sprint-1 末 Retro 议题升级 · 同族规约盲区第 5 次复发驱动
- **登记时间**：2026-05-01 21:28
- **范围**：CI 流水线引入 `miniprogram-ci` 真实编译 · 校验 `miniprogram_npm/` 构建产物可加载性 · 结构性消除"命令行五闸全绿 vs 微信 runtime 红"落差
- **建议**：参照 `check:appjson` / `check:tooling` 范式 · 新增 `scripts/devops/miniapp-build-check.mjs`（调用 miniprogram-ci API 在 CI 环境真编译一次小程序）+ `pr-check.yml` step
- **阻断级别**：P2（不阻当前 · 但属"治理性预防"）
- **认领建议**：Sprint-2 候选 CI 升级卡（与 COSTRA-117/108 联动）
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）

### FU-LIBVERSION-DEV-GUARD · CI 加 libversion=development 拦截

- **来源**：COSTRA-126 跨 lib 实测 · Human 切到 `development` lib 立即出现 5 条 framework error `(TO:基础库开发同学)` · 暴露"无防护时易踩内部分支"
- **登记时间**：2026-05-08（COSTRA-126 同轮）
- **范围**：CI 加 `check:libversion` 脚本扫 `project.config.json.libVersion` 不得为 `development`
- **建议**：Sprint-2 加入 `scripts/devops/libversion-check.mjs`（参照 `whitelist-check.mjs` / `appjson-pages-check.mjs` 范式）+ `pr-check.yml` step
- **优先级**：P3 观察（开发期偶发 · 真机不可能用 development · 边界外漂移）
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）

### FU-118-4 · miniprogram 占位页卡号幻觉（COSTRA-060/130/140/150 不存在）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-1
- **登记时间**：2026-04-24 19:35
- **范围**：
  - `pages-stat/month/index.ts` → `COSTRA-130`（不存在）
  - `pages-family/home/index.ts` → `COSTRA-140`（不存在）
  - `pages-family/settings/index.ts` → `COSTRA-150`（**冲突！现已用作 FU-103-CLIENT-SYNC-SCHEDULER 候选号**）
  - `pages-family/privacy/index.wxml` → `COSTRA-060`（不存在）
- **建议**：Sprint-2 末批一次性纠正：
  - COSTRA-130 → COSTRA-202（Epic-D 家庭成员角色）或新 COSTRA-401（Epic-F 月度报表）
  - COSTRA-150 已被 FU-103 占用 → 原改指 COSTRA-201；2026-06-02 起家庭设置重映射到 COSTRA-221/223
  - COSTRA-060 → COSTRA-109（PM 隐私指引清单）或 COSTRA-901（Epic-G 隐私协议）
- **阻断级别**：P2
- **认领建议**：Sprint-2 末文档维护批
- **状态**：`open`

### FU-DEVOPS-NGINX-ICP-HEADER · nginx 反代注入 X-ICP-Number 响应头

- **来源**：DevOps-Agent 自评 · 2026-05-13 ICP 下证后落地交付协作锚点
- **登记时间**：2026-05-13 16:57
- **背景**：腾讯云规范要求"网站底部显著位置 + 工信部超链"。Costra 当前后端纯 API 域名，未来 `api.costra.cloud` 上线 nginx 反代后，可在 HTTP 响应头注入 `X-ICP-Number: 沪ICP备2026017253号-2`，便于自动化合规巡检（如腾讯云抽查）证明备案号在线可见。
- **范围**：
  - `infra/nginx/api.costra.cloud.conf`（待创建）`add_header X-ICP-Number "沪ICP备2026017253号-2" always;`
  - **不取代** `server/src/config/icp.ts` 运行期 SSOT 与 `GET /v1/legal/icp` 程序化查询
  - 边界：nginx 配置中的备案号字符串若与代码 SSOT 漂移，由 FU-DEVOPS-ICP-CROSS-SSOT-CHECK 兜底
- **触发条件**：DNS §4.1 子记录创建 ✅ + SSL 证书签发 ✅ + nginx 反代上线 → 同卡顺手做
- **阻断级别**：P3
- **认领建议**：与 DNS+SSL+反代上线同卡顺手交付
- **状态**：`open-observation`

### FU-DEVOPS-ICP-HEALTH-PROBE · APM 拨测每日探活 GET /v1/legal/icp

- **来源**：DevOps-Agent 自评 · 2026-05-13 ICP 下证后落地交付协作锚点
- **登记时间**：2026-05-13 16:57
- **背景**：备案号字符串若被误改 / 误删 / 部署回滚，可能在不被察觉的情况下违反"显著位置可查"规范。APM 加入对 `GET /v1/legal/icp` 每日定时探活，并对 `service` / `miniapp` 字符串做 diff 校验，触发即告警。
- **范围**：
  - 拨测目标：`https://api.costra.cloud/v1/legal/icp`（生产）+ `https://api-staging.costra.cloud/v1/legal/icp`（预发）
  - 期望响应：HTTP 200 + body.service === `沪ICP备2026017253号-2` + body.miniapp === `沪ICP备2026017253号-1X`
  - 频率：每日一次即可（备案号字符串静态，不需高频）
  - 告警通道：与 COSTRA-903 APM 卡共用
- **阻断级别**：P2
- **认领建议**：合 COSTRA-903 APM 卡（同节奏：FU-115-WECHAT-WHITELIST-ALERT 也走 APM 拨测，可同卡打包）
- **状态**：`open`

### FU-DEVOPS-ICP-CROSS-SSOT-CHECK · whitelist-check.mjs 升级到强等值校验

- **来源**：DevOps-Agent 自评 · 2026-05-13 ICP 下证后落地交付协作锚点
- **登记时间**：2026-05-13 16:57
- **背景**：当前 `scripts/devops/whitelist-check.mjs assertIcpRecorded()` 只对 `infra/wechat/domains.md` §0 做"子串存在"轻量校验。两个 SSOT（运行期 `server/src/config/icp.ts ICP_INFO` + 文档 `infra/wechat/domains.md §0`）字符串若漂移不会被发现。
- **范围**：
  - 升级 `whitelist-check.mjs`：解析 `server/src/config/icp.ts` 导出的 `ICP_INFO.service` / `ICP_INFO.miniapp` 字面量，与 `domains.md §0` 表格中的备案号字符串做强等值断言
  - 任一漂移 → exit 1 + 打印 diff（参考现有 OpenAPI ↔ env.ts ↔ domains.md §1.1 三方对账实现）
  - 落地后可移除 `assertIcpRecorded()` 中的轻量子串校验，由强等值校验替代
- **阻断级别**：P2（不阻塞当前卡 · ICP 已下证字符串短期内不会变）
- **认领建议**：Sprint-2 CI 升级批，与 FU-CI-MP-BUILD-NPM-ENFORCE 同节奏
- **状态**：`open`
- **⚠️ 卡号冲突警告**：原指引 COSTRA-150 已被 FU-103-CLIENT-SYNC-SCHEDULER 占用 · 必须重新分配占位页指向

### FU-DEVOPS-OPENAPI-IMPL-COVERAGE · whitelist-check.mjs 规则 E：OpenAPI paths vs fastify register 一一对应（D-025 AP-003 自动检测）

- **来源**：Sprint-2 末 Retro 议题 25（D-025 AP-003 契约-实装漂移立案触发）+ 议题 21（CI 对账族扩展 · Sprint-3 候选规则 E）
- **登记时间**：2026-05-19 16:05（Sprint-2 末 Retro 立案）
- **背景**：COSTRA-101（2026-04-24）OpenAPI 已定义 `/users/me` GET + PATCH · 但 server 路由从未实装 · 1 个月内无人发现 · 直到 COSTRA-158（2026-05-19）才补齐。隐性 gap 累积风险高 · 需 CI 静态规则兜底。
- **范围**：
  - 升级 `scripts/devops/whitelist-check.mjs`：解析 `server/api/openapi.yaml` 所有 `paths` · 与 `server/src/app.ts` + `server/src/routes/*.ts` 中 fastify register 调用做静态对账
  - OpenAPI 定义但 server 没 register → exit 1 + 打印缺失 path 列表（除非 path 含 `x-deferred` 标记则降级 warning）
  - server register 但 OpenAPI 没定义 → exit 1（防漂移反向 · OpenAPI 是契约真源）
  - 与现有规则 D（fastify prefix vs OpenAPI servers）互补 · 同属 OpenAPI ↔ fastify 双向对账
- **依赖**：现有 `whitelist-check.mjs` 规则 D 范式（COSTRA-156 commit `edca8da`）
- **阻断级别**：P2（不阻塞当前任何卡 · 但 Sprint-3 起 154/152/153 等 OpenAPI 定义路径密集落地 · 越早做防御收益越大）
- **认领建议**：Sprint-3 中段 · DevOps-Agent 1 点小卡 · 与 FU-DEVOPS-ICP-CROSS-SSOT-CHECK 同节奏（合并升级 whitelist-check.mjs）
- **PRD 锚点**：无（CI 治理议题）
- **PRD 立意**：D-025 AP-003 契约-实装漂移自动检测 · 让"OpenAPI 早定义 server 没实装"反模式无处遁形
- **状态**：`open`
- **owner_card**：（待 Sprint-3 Planning 认领 · 候选合并到既有 whitelist-check.mjs 升级卡）

### FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE · dev `mockLogin` 从源码常量改 runtime toggle（真链路实测便利性提升）

- **来源**：2026-05-19 19:43~19:53 Human 实测 COSTRA-157+158 期间立案 · 切真链路需手改 `miniprogram/services/env.ts:18` 源码 + 重新编译 · 测完还原源码 · 不便利且易遗忘还原
- **登记时间**：2026-05-19 19:55（实测收尾期立案）
- **范围**：
  - 升级 `miniprogram/services/env.ts` · `dev.mockLogin` 不再是源码常量 · 改为 runtime 读取
  - 候选实现：(a) 读 storage `__costra_dev_flags_v1` · 提供 `wx.setStorageSync('__costra_dev_flags_v1', { mockLogin: false })` 的 console 入口 · (b) 读 `__wxConfig.envVersion === 'develop'` 时支持 ?mockLogin=false URL 参数（小程序无 URL 参数 · 此路不通）· (c) 读编译期 `process.env.MOCK_LOGIN` 通过 `npm run build:miniprogram` 注入（推荐 · 与 staging/prod 同范式）
  - 真链路实测时 console 一行命令切换 + 重启 · 不改源码 + 不留 dirty 工作树
- **依赖**：无
- **阻断级别**：P3（不阻塞任何卡 · 但 Sprint-3 起 154/152/153 真链路实测频次会增加 · 越早做收益越大）
- **认领建议**：Sprint-3 顺手 · miniapp-dev · ~30min 单 commit · 与 FU-DEVOPS-OPENAPI-IMPL-COVERAGE 同节奏批
- **PRD 锚点**：无（dev 工程便利性议题）
- **PRD 立意**：D-022 §4.1 runtime 实测前置铁律的工程支撑 · 降低真链路实测的摩擦成本
- **状态**：`open`
- **owner_card**：（待 Sprint-3 Planning 认领）

---

## 🗄 族 D · DB 治理（1 条）

### FU-DB-OPS-AUDIT · DB 全表运营风险审查（立卡前案）

- **来源**：2026-05-08 Human 在 COSTRA-102 本地 server 验证期间提出
- **登记时间**：2026-05-08 20:12（COSTRA-128 同卡簇收官后搬迁登记）
- **范围**：12 张表 + audit_logs 分区 + idempotency_keys 横切运营态健康度审查（容量 / 清理 / 索引膨胀 / 软删-硬删策略 / GDPR 对齐）
- **建议**：Backend-Agent 主驾 · DevOps 协同清理 job 落 cron · 5 项交付物（A 增长公式 / B 清理策略 / C 索引膨胀 / D 容量阈值 / E 隐私合规对齐）
- **阻断级别**：P3（治理 · 不阻当前任何卡 · MVP ~10 用户无感）
- **触发立案的可观察阈值**：
  - DAU > 100（user_sessions 估算一年 18 万行 · 仍轻量但应建立机制）
  - 或 Sprint-2+ DBA 体检窗口
- **认领建议**：Sprint-2+ Backend-Agent 主驾 · DevOps 协同
- **状态**：`open`
- **完整前案**：[`docs/db/ops-risk-audit-todo.md`](../../docs/db/ops-risk-audit-todo.md)（横切清单 + user_sessions 单表锚点）

---

## 📋 族 E · 协议 / 规约残留（1 条 · 平台限制观察）

### FU-COMMON-MINIAPP-PATCH-LIMIT · wx.request 不支持 PATCH（平台限制登记）

- **来源**：`.team/reviews/COSTRA-102/round-1-miniapp-response.md` INFO-C
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/services/request.ts` PATCH 方法在 wx.request type 中不存在 · Agent 已降级 `method === 'PATCH'` 时走 POST + `X-HTTP-Method-Override: PATCH` header
- **建议**：登记为跨卡复用的平台限制 · server 侧约定处理该 header · 不可修
- **阻断级别**：原 O 观察 → **升级 P2 实装**（2026-05-19 调研发现真实根因双重 · server 路由完全未实装 + 平台限制 · 已挂 COSTRA-158）
- **认领建议**：✅ **已由 COSTRA-158 闭环**（server PATCH /users/me 路由实装 + K3 method-override 兜底 · client 现有降级链路验证可用）
- **状态**：`closed @ COSTRA-158`（server PATCH route 实装 + K3 method-override 兼容 · client 降级链路验证可用）
- **owner_card**：~~COSTRA-158~~（已闭环）
- **闭合条件**（COSTRA-158 R1 一并兑现 ✅）：
  - ✅ server PATCH /users/me 路由真实存在 + POST /users/me K3 method-override 兜底
  - ⏳ E2E 实测：client login 后真调 PATCH 200（不再撞 404 soft-fail）· 等 Human 实测（dispatch §9 步骤 4）
  - ✅ 关闭时同步移除 dispatch 中"留 COSTRA-152 顺手做"的旧建议
- **🆕 真实根因更正**（2026-05-19 调研）：原归因仅"wx.request 不支持 PATCH"只覆盖一半 · 调研 COSTRA-158 时发现 **server PATCH /users/me 路由完全未实装**（OpenAPI 早定义但 server/src/routes/ 无 users.ts · COSTRA-101 遗留 gap）· 即便 client 用真 PATCH 也会 404 · 双重原因
- **🆕 首次实触发观察**（2026-05-01 21:18 · COSTRA-123 Human 第 6 次模拟器启动）：
  - 现象：`request.ts:88 POST http://localhost:8080/v1/users/me 404` + `[login] PATCH /users/me soft-fail Error: route not found`
  - 链路精准命中 R1 Review §P1-2 预言（`.team/reviews/COSTRA-102/round-1-tech.md:74-81`）
  - 兜底有效：`pages/login/index.ts:68` `catch (e) { console.warn }` 打印 `soft-fail` · 不阻登录流程
  - **三方案预议历史**（保留 · 但 K3 兜底已被 COSTRA-158 选定）：(a) server/Fastify 加统一 `methodOverride` 中间件（K1 · 全局）· (b) MiniApp 切到 DELETE+重建语义（不可行）· (c) OpenAPI 改 PATCH → PUT（无破坏 · 语义等价 · 之前推荐 · 现被 K3 替代以保护 OpenAPI 纯净）

### FU-K3-TO-K1-UPGRADE · K3 局部 method-override → K1 全局 middleware 升级评估

- **来源**：Sprint-2 末 Retro 议题 Sprint-3-B（D-024 §2.4 关联 · COSTRA-158 dispatch §5.3 已知未知 · review-tech R1 INFO-2 强化）
- **登记时间**：2026-05-19 16:05（Sprint-2 末 Retro 立案）
- **背景**：
  - COSTRA-158 R1 在 `server/src/routes/users.ts` 内 POST handler 识别 `X-HTTP-Method-Override: PATCH` 后委托给 PATCH handler（**K3 局部兜底**）· 作用域最小 · 不影响其他路由
  - COSTRA-152 PATCH /entries/{entry_id} 实装时同样需要 method-override 兼容（wx.request 不支持 PATCH 是平台限制）· 若仍走 K3 模式 · 在 entries 路由内重复一次相同代码（约 10 行）
  - K1 全局 method-override middleware 在 `server/src/app.ts` 注册一次 · 所有路由自动支持 X-HTTP-Method-Override
- **范围**：
  - 在 COSTRA-152 dispatch 阶段评估：是否将 K3 模式升级为 K1 全局 middleware
  - 决策依据：① Sprint-3 起预计还有几个 PATCH 路由需要 method-override（152 + 153 DELETE 是否也需要）/ ② K1 全局 middleware 实装复杂度（fastify-method-override 库 vs 自实现）/ ③ 与现有 K3 兼容（同时存在不冲突 · K1 优先识别 · K3 fallback 不触发）
  - 升级时同步移除 158 R1 的 K3 局部代码（约 10 行）· 反向兼容 X-HTTP-Method-Override header
- **依赖**：
  - 必须：COSTRA-158 R1 CLOSED（K3 实装为升级基线）
  - 触发：COSTRA-152 dispatch（评估 K3 vs K1 取舍）
- **阻断级别**：P2（不阻 152 启动 · 选 K3 持续路径继续工作 · 但若评估后选 K1 则在 152 dispatch 内一并实装）
- **认领建议**：COSTRA-152 dispatch 阶段评估 · backend-dev 提议 · 走 D-017 §2.4 验证问题响应 SOP 上报决策点
- **PRD 锚点**：无（架构层议题）
- **状态**：`open`
- **owner_card**：COSTRA-152（dispatch 时评估 · 升级或保持 K3 的决策都在 152 卡内做）

---

## 🧪 族 F · QA 自动化（2 条）

### FU-105-AUTOMATION-FULL-COVERAGE · 全量 14 用例自动化 + CI 集成

- **来源**：COSTRA-105 R1 Card-Review P1-1（自动化脚手架降级路径）+ DoD §3.3（形式 ② README 占位）
- **登记时间**：2026-05-12（COSTRA-105 R1 实装 · qa-planner 首次实战）
- **范围**：
  - 安装 `miniprogram-automator`（npm 包 + 微信开发者工具端口暴露配置）
  - 实装 14 条用例自动化（SU-001~014）
  - 集成 CI 流水线（`.github/workflows/pr-check.yml` 新增 `test:e2e` step）
  - 目标：核心链路自动化覆盖 ≥ 80%
- **依赖**：
  - COSTRA-104 server `/sync/push` + `/entries` 端点稳定
  - `FU-103-CLIENT-SYNC-SCHEDULER`（client 调度器实装）
- **PRD 锚点**：Epic-B（单人记账）+ Epic-C（离线同步）全链路自动化覆盖
- **阻断级别**：P2（不阻 COSTRA-105 终审 · 但影响 Sprint-3 发版覆盖率）
- **认领建议**：Sprint-3 头部（COSTRA-155 候选 · 5 点 · owner=qa-planner+miniapp-dev）
- **状态**：`open`
- **owner_card**：（待 Sprint-3 Planning 认领）

### FU-156-OUTBOX-FLAKY · client outbox.spec.ts 时间相关 flaky test 修复

- **来源**：2026-05-13 11:27 COSTRA-156 R1 review-tech 独立 5 次跑诊断（2/5 失败 3/5 通过 · 非确定性）
- **性质**：pre-existing flaky（COSTRA-103 R1 client outbox 实装时引入 · COSTRA-156 0 改动 miniprogram 仅触发显式化）
- **失败行**：`miniprogram/services/outbox.spec.ts:102` `expect(result2!.batch[0].next_retry_at > Date.now()).toBe(true)`
- **根因**：测试代码 setup `next_retry_at = Date.now() + 1` · 断言时再取 `Date.now()` · 若间隔超 1ms 则 `next_retry_at <= Date.now()` · 时间相关 race condition（毫秒级精度）
- **修复方案候选**：
  - A. 增大 buffer：`next_retry_at = Date.now() + 100`（简单粗暴 · 不彻底）
  - B. 用 `>=` 替换 `>`（语义不严格 · 能避 race）
  - **C. fake timers**（`vi.useFakeTimers()` · 标准做法 · 需重构 outbox.ts 时间依赖 · 推荐）
- **阻断级别**：P2（不阻 156/105 终审 · 影响 CI 稳定性 · 当前 root vitest 偶发 1 失败）
- **认领建议**：Sprint-3 头部 miniapp-dev · 0.5~1 点
- **PRD 锚点**：无（CI 稳定性议题）
- **依赖**：无（独立 fix）
- **状态**：`open`
- **owner_card**：（待 Sprint-3 Planning 认领）

---

## 🌐 族 G · 外部触发（1 条 · Human 主动）

### FU-115-2 · ICP 下证后配 api.costra.cloud 至微信服务器域名白名单

- **来源**：`infra/wechat/domains.md §4` Human 操作手册 + `.team/risks.md` R-013 关闭条件
- **登记时间**：2026-04-27 10:54
- **范围**：ICP 备案下证后，Human 按 `infra/wechat/domains.md §4` 三步执行：
  1. 阿里云 DNS 添加 A 记录 `api.costra.cloud → 49.235.216.20`
  2. 微信公众平台后台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名添加 `https://api.costra.cloud`
  3. 发 `close:R-013`
- **建议**：Orchestrator 在 `.team/STATE` 每周提醒 `R-013 mitigate` 状态 · ICP 下证日零延迟触发
- **阻断级别**：O-观察（非 Agent 可执 · Human 主动 · 外部依赖触发）
- **认领建议**：**Human · 外部触发**（估 2026-05 中下旬 ICP 下证日）
- **状态**：`open`

---

## 🐛 族 H · QA 实测发现（2026-05-18 · COSTRA-105 D.1 真链路实测兑现 D-022 §4.1）

> **族说明**：D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律首次真兑现立意——自动化 + curl + server 单测 30+ 全绿，但 Human 真链路实测 ~30 分钟内捕获 4 个文档 gap + 1 个真 P0 双责 BUG。详见 `qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md`。

### FU-105-DEV-CONSOLE-HOOK · client app.ts dev-only 调试钩子

- **来源**：`qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md` §4
- **登记时间**：2026-05-18 19:5x
- **范围**：`miniprogram/app.ts` onLaunch 内加 ~5 行 dev-only 守卫：
  ```ts
  if (this.globalData.env.name === 'dev') {
    import('./services/sync').then(({ pushDelta, syncPull }) => {
      (wx as any).__costra_dev_sync__ = { pushDelta, syncPull };
    });
  }
  ```
- **价值**：D.1/D.2 实测命令回切真路径（`wx.__costra_dev_sync__.pushDelta()` / `syncPull(familyId)`） · 完整保留 H6 立意（端到端 client 调用栈含 request.ts token/idempotency-key 注入 + ackResults 自动出队 + applyServerChanges 自动落 storage）· prod 构建产物不含此钩子（编译期常量 + dev env 双重隔离）
- **依赖**：构建脚本未来需保证 prod build 时 strip dev-only 代码（COSTRA-160 设计 tokens pipeline 顺手做 · 或独立小卡）
- **阻断级别**：**P3**（fallback 模式可达成 D1.1+D1.3 PASS · H6 立意可由方式 C 真链路验证 · 不阻断双卡 approve）
- **认领建议**：Sprint-3 头部 miniapp-dev（与 COSTRA-150 sync scheduler 同轮交付 · ~ 5 分钟改动）
- **状态**：`open`
- **owner_card**：未定（候选 COSTRA-150 顺带 / 或独立 1 点小卡）

### BUG-105-D1-LEDGER-ID-DEFAULT · client `pages/entry/index.ts` 硬编码 `ledger_id: 'default'` 字面量（P0 真 BUG · 已修）

- **来源**：`qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md` §1
- **登记时间**：2026-05-18 19:5x
- **范围**：`miniprogram/pages/entry/index.ts` line 57+73 把 `ledger_id` 硬编码字符串 `"default"`（COSTRA-103 R1 留 TODO + COSTRA-104 R1 未接续 · scope gap fall-through）· server 端推 push 时 PG 22P02 invalid uuid 错误 → 500
- **修复方案**：阶段 1 紧急止血用 `getApp().globalData.activeLedgerId || FALLBACK_LEDGER_ID`（`00000000-0000-0000-0000-000000000001` seed 默认）· 阶段 2 由 COSTRA-155 ledgers CRUD 卡接续做真选账本 UI
- **阻断级别**：~~**P0**~~ → 已止血
- **认领建议**：~~COSTRA-105 R1.x.1~~ · 已完成
- **状态**：`closed @ commit 33dbdea`（COSTRA-105 R1.x.1 · miniapp-dev · 单 commit 收尾 · D-017 v3 §2.4 E1 路径 · COSTRA-105 已 Human T1 APPROVED CLOSED @ 2026-05-19 09:27）
- **resolved_by**：commit `33dbdea` (`fix(miniapp): replace ledger_id "default" literal with fallback uuid (COSTRA-105 R1.x.1 BUG-001)`)
- **阶段 2 接续**：COSTRA-155（Sprint-3 候选 · ledgers CRUD 真选账本 UI）

### BUG-156-SYNC-PUSH-PAYLOAD-NO-UUID-VALIDATION · server `routes/sync.ts` payload 不校验 UUID 格式（P0 真 BUG · 已修）

- **来源**：`qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md` §2
- **登记时间**：2026-05-18 19:5x
- **范围**：`server/src/routes/sync.ts` line 93 `payload: { type: 'object', additionalProperties: true }` · 完全无 UUID format 校验 · 非法 UUID 直接喂 PG → 22P02 → 500（应返 400 BAD_REQUEST · `code: INVALID_ARGUMENT`）
- **修复方案**：阶段 1 在 schema 加 `properties: { ledger_id: { type: 'string', format: 'uuid' }, category_id: { type: ['string','null'], format: 'uuid' } }` + 加 1 个单测 case rejects-non-uuid · 阶段 2 由 COSTRA-155 完整 entry/ledger schema 校验补全
- **阻断级别**：~~**P0**~~ → 已止血
- **认领建议**：~~COSTRA-105 R1.x.2~~ · 已完成
- **状态**：`closed @ commit db488b9`（COSTRA-105 R1.x.2 · backend-dev · 单 commit 收尾 · D-017 v3 §2.4 E1 路径 · 与 R1.x.1 同轮交付）
- **resolved_by**：commit `db488b9` (`fix(backend): add uuid format validation to sync/push payload schema (COSTRA-105 R1.x.2 BUG-002)`)
- **阶段 2 接续**：COSTRA-155（Sprint-3 候选 · 完整 entry/ledger schema 校验补全）

> 💡 **族 H 设计意图**：
> - **集中登记 Human 实测期发现的债务**（vs 族 A~G 的 Review/Card-Review 期发现）
> - **3 类内容混排**：FU（dev-only 调试钩子）+ BUG（client 端字段填充）+ BUG（server 端 schema 校验）—— 因为它们在同一次实测会话中根因关联（联合触发链）· 分散到不同族会丢失上下文
> - **后续族 H+ 维护**：每次 Human 真链路实测会话发现的 BUG/FU 集中追加（按时间线 · 不同会话隔行分组）

---

## 🌐 族 I · QA 流程治理（占位 · 当前空 · 留 Sprint-2 末 Retro 议题落地）

> **族说明**（占位）：本次实测会话暴露 4 项跨族议题（手册写作 dry-run 强制 / scope gap 跨卡 fall-through / server 单测 fuzz 缺失 / CI schema 对账 E 规则候选）· 待 Sprint-2 末 Retro 决议落地后转 FU 入此族 · 详见 `qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md` §6。

---

## 🔐 族 J · Auth / 安全（Sprint-4+ 候选）

### FU-AUTH-ROTATING-REFRESH · refresh_token 轮换 + 重用检测

- **来源**：2026-05-25 Human 与 Orchestrator 复盘 JWT 双 token 方案 · 确认当前 MVP 为「不轮换」refresh
- **登记时间**：2026-05-25
- **现状事实源**：
  - `server/src/services/authService.ts:172` 注释 `// MVP 策略：只签新 access_token，refresh_token 保持原值（不滑动续期，见 ttl-policy.md §7）`
  - `server/db/migrations/0003_user_sessions.sql:13` 注释 `刷新 = 查有效 → 签新 access_token；refresh_token 沿用旧值（MVP 不换发）`
  - `docs/api/ttl-policy.md §7` 已列入「调优空间（非 MVP）」，明示 Sprint-2+ 评估
- **范围**：
  1. **轮换原子化**：`/auth/refresh` 时签发新 refresh + 同事务吊销旧 jti（`UPDATE user_sessions SET revoked_at=now() WHERE jti=$old AND revoked_at IS NULL RETURNING *` + `INSERT $new`，用 RETURNING 行数判断是否抢到锁，防双花）
  2. **重用检测**（OAuth 2.1 §6.1 标准做法）：已 `revoked_at` 的 refresh 再次出现 → 立即 `revokeAllByUser` + 写审计日志告警，作为「token 泄漏」信号
  3. **DB schema**（视方案选型）：可选给 `user_sessions` 加 `version` 列做乐观锁，或加 `rotated_from` 列存上一代 jti 形成血缘链
  4. Redis 同步轮换（DEL 旧 key + SET 新 key）
- **主要改动面**：
  - `server/src/services/authService.ts` `refresh()` 函数体重写（含原子轮换 + 重用检测分支）
  - `server/src/repositories/sessionRepo.ts` 新增 `rotate(oldJti, newSession)` 方法
  - `server/db/migrations/00xx_user_sessions_rotating.sql`（如需新列）
  - `docs/api/ttl-policy.md §7` → 升级为 §4.x 正式实装段
  - `server/test/auth.test.ts` 新增 case
- **必带测试用例**：
  - 串行：refresh 一次后旧 refresh 立即作废、新 refresh 可用
  - 并发：同 refresh 并发调 2 次 → 仅 1 份成功、另 1 份返回 `REFRESH_TOKEN_INVALID`（验原子性）
  - 重用：用旧 refresh 再次调 refresh → 该用户全部 session 被吊销 + 审计日志写入
  - 兼容：access TTL 内未 refresh 的客户端不受影响
- **客户端联动**：MiniApp `request.ts` 续期拦截器需更新「拿到新 refresh 后必须覆盖 storage」的逻辑（当前因不轮换可省略，轮换后强制）
- **依赖**：无强依赖；建议在 Sprint-3 sync 协议族全部收口、auth 链路稳定后启动
- **阻断级别**：**P2**（当前 MVP 安全可接受 · 30 天 refresh 泄漏窗口属可控风险 · 用户量级上来或安全审计要求时升 P1）
- **认领建议**：Sprint-4+ Backend-Agent 主驾 · Card-Review 阶段确认 schema 选型（`version` vs `rotated_from`）· QA-Agent 协同设计并发用例（pg-mem 可能不足以模拟 SERIALIZABLE 隔离 · 需考虑 Postgres 真容器测）
- **触发立卡的可观察阈值**：
  - DAU 上来或对外开放注册 → refresh 泄漏面扩大
  - 安全审计 / 合规审查要求
  - Sprint-4+ 认证强化批（如同时做多端 session 管理 / `/auth/sessions` 列表，可合卡）
- **状态**：`open`
- **owner_card**：未定

---

_本文件由 Orchestrator 按需追加；不直接编辑，仅在 Agent Revision Response 产出时同步新增条目。已闭合条目归档至 `.team/_archive/follow-ups-closed-sprint-1.md`。_
