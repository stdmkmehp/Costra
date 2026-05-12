# COSTRA-104 · FINAL · Human T1 终审记录

> **Sprint-2 主线第 3 张 · Epic-C 离线优先架构 server 侧主头收官**
> **D-022 v2.0 评分表第 2 次实战 · APPROVE 36/40**
> **切出去 3 件套铁律首次实战 · 9/9 完整性**
> **dev DX 治理三件套范式建立**（WX mock + psql seed + npm scripts）

---

## §1 元数据

| 字段 | 值 |
|---|---|
| 卡号 | COSTRA-104 |
| 标题 | Backend `/sync/push` 主通道 + `/entries` POST/GET + 切出去 3 件套铁律 |
| Owner | backend-dev（**首次实战** · SBAI v1.1 第 8 次冒烟） |
| Sprint | sprint-2 · 主线第 3 张 |
| Epic | Epic-C |
| 估点 | 7（原 6 + Q1.4 切出去铁律 +1） |
| 优先级 | P0 |
| 立卡时间 | 2026-05-11 12:55 |
| **Human T1 终审时间** | **2026-05-12 13:54** |
| Human 决策 | `approve:COSTRA-104` |
| 总耗时 | ~ 25 小时（含跨日 + 多轮 R1.x 修复 + Human curl 实测）|
| 总 commits | 16（feat × 3 / fix × 4 / docs × 2 / chore × 6 / feat-devops × 1） |

---

## §2 R1 + R1.x 系列实装产出（16 commits 全链）

```
5279343 feat(devops)  3 dev scripts (migrate / reset-data / seed-curl-test) [+218]
a575a4a fix(backend)  post /entries pass client_ref_id (R1.x.3 · P1) [+8/-1]
9845d82 docs(qa)      curl-verify v1.4 (db migrations 全跑齐 §0.3) [+32/-2]
929942f fix(db)       entries.account_id + to_account_id columns (R1.x.2) [+24]
b4544d5 docs(qa)      curl-verify v1.3 (psql seed step b.5) [+89/-2]
6b242e4 fix(backend)  wx mock dynamic→static import (修 ESM/CJS 互操作) [+3/-2]
454cb82 chore(repo)   backend-dev state/history closure r1.x.1 [+42/-1]
95e00c6 feat(backend) dev wx_mock_login env switch (R1.x.1) [+50]
db1f1fc docs(qa)      curl-verify v1.1 (port 3000→8080 + pino log) [+20/-15]
3ba84d8 chore(repo)   round-1-tech review report (approve 36/40) [+230]
54cd931 chore(repo)   backend-dev state/history closure r1.x [+69/-3]
363efa1 fix(backend)  T2 update conflict 测 + followup_id (R1.x · P1+P2) [+92/-12]
212f181 chore(repo)   dispatch + card-review + curl-verify + 3 FU [+1008/-6]
6c17085 chore(repo)   backend-dev state/history r1 closure [+89/-7]
6d395bd feat(backend)  sync/push + entries crud + 3 stub routes (R1) [+1520/-6]
（待本 commit）docs(repo): costra-104 human t1 approved closed (sprint-2 主线第 3 张收官)
```

主代码净增 ~ 1517 行（dispatch §7 预期 ≥ 1100 行）· 测 345 行 · 文档 327 行（curl-verify v1.4 + scripts/dev/README）· devops 脚本 218 行。

---

## §3 评审链

| 节点 | 输出 | 结果 |
|---|---|---|
| Card-Review（D-014-a · `costra-card-reviewer-tech` · 第 5 次实战）| `card-review-round-1-tech.md` | **PASS 29/30** · 0 P0 / 0 P1 / 1 P2（措辞瑕疵 · R1 已采纳）|
| **R1 实装**（backend-dev 第 1~5 次实战 · R1+R1.1+R1.2+R1.x+R1.x.1+R1.x.2+R1.x.3 共 7 轮）| 主代码 11 文件 + 测 + 文档 | 闸门全绿 |
| Review-Tech R1（D-022 v2.0 第 2 次实战 · 第 6 次审查档实战）| `round-1-tech.md` | **APPROVE 36/40** · 0 P0 / 1 P1（T2 测 R1.x 修）/ 2 P2（followup_id R1.x 修 + D-016 反例）|
| **Human curl 实测**（D-022 §4.2 等效 runtime · 14 commits 多轮迭代）| `curl-verify v1.4` | **5/5 步 + 3/3 硬断言全 PASS** ✅ |
| **Human T1 终审** | `approve:COSTRA-104` | **APPROVED · CLOSED** |

---

## §4 协议契约自检（review-tech 验收 + Human curl 实测验证）

| 维度 | 验证 | 结果 |
|---|---|---|
| payload 100% snake_case | grep amountCents/categoryId/occurredAt server/src/{routes,services} | 0 命中 ✅ |
| entity 枚举 ∈ {entry, category, budget} | sync.ts:89-90 严格匹配 | ✅ |
| status 三态 ∈ {ok, conflict, rejected} | curl 实测 step D 全命中 | ✅ |
| ErrorCode 全用枚举（不硬编码字符串）| grep "throw new Error(" routes/services | 0 命中 ✅ |
| 三种 ID 严禁混用 | client_ref_id（client）/ server_id uuidv7 / Idempotency-Key（24h 缓存）| ✅ |
| 24h 强幂等 | curl 实测 step E.1 重发返缓存 + step E.2 mismatch 409 | ✅ |
| 切出去 3 件套铁律 | OpenAPI x-deferred × 3 + FU 立件 × 3 + route stub 501 不静默 × 3 | 9/9 ✅ |
| 0 跨域改动 | git diff HEAD~16..HEAD -- miniprogram/ docs/api/ | **空** ✅ |

> ⚠️ 越权例外：本卡 R1.x.2 经 Human + Orchestrator 显式授权改 `server/db/migrations/`（新增 0004 修 schema gap · 不动 0001/0002/0003 既有内容）· D-017 §2.4 E1 例外路径合规。

---

## §5 闸门最终状态

```
typecheck       ✅ 0 错
test            ✅ 20/20 全绿（R1 19 + R1.x 补 T2 update conflict = 20）
lint            ✅ exit 0（COSTRA-117 deferred）
x-deferred=3    ✅ openapi.yaml 3 处
deferred_card≥3 ✅ entries.ts × 2 + sync.ts × 1
followup_id     ✅ 全部统一（R1.x.0 修 followup → followup_id）
跨域 diff       ✅ miniprogram/ + docs/api/ 全空
```

**Human curl 实测**：

```
A 启动检查        ✅ healthz 200
B 登录拿 JWT      ✅ access_token + user.id snake_case（dev WX mock 生效）
B.5 psql seed     ✅ family/ledger/family_members 3 行
C POST /entries   ✅ 201 + Entry 全字段 + client_ref_id 持久化（R1.x.3 修复生效）
D POST /sync/push ✅ 三态全命中（ok + rejected NOT_IMPLEMENTED + conflict）+ 3 stub 501 + deferred_card + followup_id
E 幂等 + mismatch ✅ E.1 returncache · E.2 IDEMPOTENCY_KEY_MISMATCH 409
H1 snake_case      ✅
H2 切出去铁律 stub ✅
H3 24h 强幂等      ✅
```

---

## §6 切出去 3 件套铁律首次实战 · 9/9 完整性

| stub | L1 OpenAPI x-deferred | L2 FU 立件 | L3 stub 501 不静默 |
|---|---|---|---|
| PATCH /entries/{id} | ✅ COSTRA-152 | ✅ FU-104-ENTRIES-PATCH (P1 · 3 点) | ✅ deferred_card + followup_id |
| DELETE /entries/{id} | ✅ COSTRA-153 | ✅ FU-104-ENTRIES-DELETE (P1 · 2 点) | ✅ deferred_card + followup_id |
| GET /sync/pull | ✅ COSTRA-154 | ✅ FU-104-SYNC-PULL (P0 · 5 点 · PRD AC-4 核心) | ✅ deferred_card + followup_id |

**3 stub × 3 件套 = 9/9 全到位** · Sprint-2 范式正式建立。

---

## §7 dev DX 治理三件套范式建立 · COSTRA-104 留下的长期资产

| 件 | 入口 | 价值 |
|---|---|---|
| **WX_MOCK_LOGIN env 开关** | `WX_MOCK_LOGIN=1 npm run dev` | dev 期 curl 实测可用 · prod 启动 loadEnv 校验拒绝 · 永不暴露 |
| **psql seed 脚本化** | `USER_ID=... npm run db:seed:curl-test` | curl 实测前置准备从 5 分钟 → 5 秒 |
| **DB migrate / reset-data / seed 三脚本** | `npm run db:migrate` / `db:reset-data` / `db:seed:curl-test` | DevOps 入口标准化 · package.json 暴露 |

文档：`server/scripts/dev/README.md`（用法 + env vars + 安全保护 + 工作流）。

---

## §8 教训沉淀（Sprint-2 末 Retro 议题清单 · COSTRA-104 累计 7 项）

| # | 议题 | 触发场景 |
|---|---|---|
| 1 | **装扮档 6+ 点卡需在 R1 内分阶段 commit**（D-016 累计反例 6 次：COSTRA-103 × 3 + COSTRA-104 × 3）| R1.0/R1.1/R1.2 漏 commit 反复 · Orchestrator 接管兜底 3 次 |
| 2 | **G3 闸门加 OpenAPI vs DB schema 列对账 CI**（COSTRA-115/116 CI 对账族第 4 张候选）| R1.x.2 暴露 entries.account_id 协议有 schema 漏建（COSTRA-020 R2 P0-1）|
| 3 | **test/setup.ts 维护两套 schema 真相反模式** | 测掩盖 schema gap BUG · 真实 PG 跑炸 |
| 4 | **review-tech 评分应增"测应有 request → response 全字段保真断言"维度** | R1.x.3 暴露 entries POST 漏桥接 client_ref_id（review-tech 38/40 没发现）|
| 5 | **review-tech 评分应增"create UNIQUE 触发 conflict 端到端路径覆盖"维度** | step D op[2] 第一次跑因脏数据走 ok 路径 · UNIQUE 三态没真正测 |
| 6 | **scope gap 审查机制：审查档应额外评"卡范围是否跳出 PRD AC 链路完整性"**（同 COSTRA-103 watermark 范式延续）| Human 实测发现 families/ledgers CRUD scope gap |
| 7 | **migrate.sh 幂等性议题**：0001/0003 重跑会报错 · 当前脚本静默继续；建议加 `psql -v ON_ERROR_STOP=1` + 或迁移到状态化 migrations | reset-data 后跑 migrate · 实测发现非幂等 |

---

## §9 范式建立（正向 · 4 项）

| # | 范式 | 价值 |
|---|---|---|
| 1 | **D-017 v3 §2.4 E1 例外路径多次实战**（R1.x · R1.x.1 · R1.x.2 · R1.x.3 · 4 轮 P1/P2 修复 · 全部走窄 prompt + Orchestrator 越权接管）| Sprint-2 主流处置模式 · ≤ 5 分钟单 commit 收尾 |
| 2 | **切出去 3 件套铁律首次实战 9/9** | 协议契约部分实装 + 文档 + FU + 代码标记 三层防腐 · 长期资产 |
| 3 | **dev DX 治理三件套**（WX mock + psql seed + npm scripts）| 长期 backend 开发体验提升 · 后续卡受益 |
| 4 | **D-022 v2.0 评分表第 2 次实战**（COSTRA-103 38/40 → COSTRA-104 36/40）| 评分表对纯 server 卡的 C8/C10 维度适用性验证 |

---

## §10 后续 follow-up（已立件 · Sprint-3 候选）

| FU-ID | 候选卡号 | 估点 | 阻断 | 描述 |
|---|---|---|---|---|
| FU-104-ENTRIES-PATCH | COSTRA-152 | 3 | P1 | PATCH /entries/{id} 实装（替代 R1 stub 501）|
| FU-104-ENTRIES-DELETE | COSTRA-153 | 2 | P1 | DELETE /entries/{id} 软删实装（替代 R1 stub 501）|
| FU-104-SYNC-PULL | COSTRA-154 | 5 | **P0** | GET /sync/pull 增量拉取（PRD AC-4 核心 + 与 COSTRA-150 client 调度器联动）|
| FU-EPIC-FAMILY-LEDGER-CRUD | COSTRA-155 | 8 | P0 | families + ledgers CRUD（OpenAPI 已定义但路由 0 实装 · scope gap）|
| FU-104-DB-MIGRATE-SCRIPT | (待 Sprint-3 立) | 1 | P2 | migrate.sh 幂等性 + 状态化（议题 7 转 FU）|

合计：Sprint-3 候选 19 点（103 残留 10 点 · 104 残留 19 点 · 未含其他卡）

---

## §11 Verdict

### **APPROVED · CLOSED · 2026-05-12 13:54**

- 总分 36/40（D-022 v2.0 ≥ 36 APPROVE）
- 红线 6/6 全 PASS
- Human curl 实测 5 步 + 3 硬断言全 PASS
- 切出去 3 件套铁律 9/9 完整性
- 0 P0 / 1 P1（R1.x 已修）/ 2 P2（R1.x.0/已转议题）

**Sprint-2 主线第 3 张正式收官。**

---

## §12 Orchestrator 内部审计声明

- **审查档第 6 次实战**（card-reviewer-tech 5 次 + review-tech 1 次）· 0 写入纪律 100%
- **D-022 v2.0 评分表第 2 次实战**（首次 = COSTRA-103 38/40）· 评分体系成熟
- **D-018 §3.5 越权例外路径** · Orchestrator 接管 4 次（state/history × 2 + 1 行 fix × 2）· 模式成熟
- **D-016 反例累计 6 次**（议题升级中 · Sprint-2 末 Retro 必处置）

**审查盲区记录**（Sprint-2 末 Retro 议题 4/5/6 来源）：

- review-tech R1 38/40 未发现 schema gap（议题 2/3）
- review-tech R1 38/40 未发现 client_ref_id 桥接 BUG（议题 4）
- review-tech R1 38/40 未发现 UNIQUE 触发 conflict 端到端路径未覆盖（议题 5）

**结论**：Human 实测前置铁律（D-022 §4.2 等效 runtime）有效抑制 review-tech 漏审风险 · 范式应继续。

---

修订记录：
- v1.0 · 2026-05-12 13:55 · COSTRA-104 Human T1 终审记录首版
