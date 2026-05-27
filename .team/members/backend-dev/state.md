# backend-dev · state.md

> 角色规则来源：`.team/agents/04-backend-agent.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 backend-dev（旧 Backend-Agent）执行服务端开发。

- 角色文件：`.team/agents/04-backend-agent.md`
- **已知偏差**：角色文件写 Go/Gin/gRPC 技术栈 · 实际 ADR-0002 定的是 Node/TS/Fastify · 装扮时以 ADR-0002 + `server/package.json` 实际为准

## §2 当前关注（active tasks）

- 🆕 **COSTRA-164 R1 实装完成**（2026-05-27 · server family bootstrap MVP · wxLogin atomic 建个人 family+ledger · AuthTokenPair 加 default_family_id/ledger_id · migration 0007 family_kind ENUM + partial unique index · familyRepo + ledgerRepo 新建 · ErrorCode FAMILY_PERSONAL_NOT_DELETABLE · env.ts 加 MAX_FAMILIES_PER_USER/USER_VISIBLE_FAMILY_LIMIT · T1~T10 单测全绿 · 80/80 全绿 · 等 review-tech R1 + Human T1 approve + 165 联合实测）
- ✅ **COSTRA-152 + COSTRA-153 双卡 Human T1 APPROVED CLOSED**（2026-05-23 16:15 · 联合双卡同轮 approve · D-024 §2.2 C1 第 4 次实战完美收官）· **152 APPROVE 37/40**（R1 commit `513dd5a` + R1.x.1 `167bf17` · 含 P0 跨 family 守门补丁三处共享）· **153 APPROVE 39/40**（R1 commit `ccd80b9` + R1.x.1 `167bf17` 双胞胎同 commit · 满分趋势）· Human curl 实测 5 硬断言 H1~H5 全 PASS · 实测手册 `docs/qa/costra-152-153-curl-verify.md` v1.0（746 行 · commit `cfdb6e1`）· FINAL.md 已落档 · FU-104-ENTRIES-PATCH/DELETE + FU-CROSS-FAMILY-GUARD-COSTRA-104 全 closed · 范式：D-014 第 3 次完美收官 / D-016 连续第 7~8 张 / D-022 v2.0 第 9~10 次 / D-025 AP-003 第 4~5 次 / Sprint-3 头部 4/9 卡 CLOSED · 估点 15/29 = 52%
- 🆕 **COSTRA-154 R1.x.2 v1.2 协议升级完成**（2026-05-22 17:30 · commit `31fb893` · 联合 staging 实测发现 P1 watermark 微秒精度截断 BUG → Human 选项 B 同轮升级 ISO 时间戳 → BIGINT change_seq · migration 0006 SEQUENCE entries_change_seq + entryRepo 显式 nextval + syncPullService watermark BIGINT + sync-pull.test +T18/T19/T20 + openapi int64 · server 56/56 PASS · 等 Human staging 重启 migration + 再次联合实测 + approve）
- ✅ **COSTRA-154 R1 实装完成 + R1.x.1 修订**（2026-05-19 · R1 commit `7e87bad` · R1.x.1 修订 P1-1 ledgers 类型 unknown[] + P1-2 commit hash 引用统一 5 处 · D-017 v3 §2.4 E1 第 8 次实战 · review-tech R1 verdict PASS-WITH-FOLLOWUP 36/40 → R1.x.1 修订后 APPROVE 38/40）
- ✅ **COSTRA-156 Human T1 APPROVED CLOSED**（2026-05-19 09:27 · 联合 105 双卡同轮 approve · 终审报告 `.team/reviews/COSTRA-156/FINAL.md` · D-022 v2.0 第 4 次实战 40/40 连续满分）
- ✅ **COSTRA-105 R1.x.2 BUG-002 已闭环**（commit `db488b9` · 联合 105 终审 partial PASS 同轮 CLOSED）
- ✅ **COSTRA-158 R1 backend 段完成**（8 项 server 改动 A~G' · 闸门全绿 · 等 miniapp-dev 接手 H~K + 统一 commit）
- COSTRA-157 R1 实装进行中（backend 段完成 · 等 miniapp-dev 接手 B/C/D/E + 统一 commit）

## §3 交付历史索引

- **2026-05-22** · **COSTRA-152 + COSTRA-153 双卡联合 R1 实装**（PATCH /entries/{id} + DELETE /entries/{id} 软删 + P0 跨 family 守门补丁 + K3 method-override + version+1 显式 SET 修复 · 70/70 测全绿 · 守门反向验证通过）· `history/2026-05-22-costra-152-r1-patch-and-cross-family-guard.md` + `history/2026-05-22-costra-153-r1-soft-delete.md`
- **2026-05-22** · **COSTRA-154 R1.x.2 v1.2 协议升级**（联合实测 P1 watermark 精度截断 → Human 选项 B 彻底升级 ISO → BIGINT change_seq · migration 0006 + entryRepo 显式 nextval + syncPullService BIGINT + pg-mem setval mock + sync-pull.test +T18/T19/T20 + openapi int64 · server 56/56 PASS · commit `31fb893`）· `history/2026-05-22-costra-154-r1x2-watermark-v1.2-upgrade.md`
- 2026-05-19 · **COSTRA-154 R1 实装**（GET /sync/pull 增量拉取 · 9 项 scope A~I · 替代 stub 501 · entryRepo findEntriesByFamilySince + syncPullService + routes 真实装 + OpenAPI x-deferred 删 + 14 单测 T1~T14 · FU-104-SYNC-PULL closed · 105 D2 defect resolved）· `history/2026-05-19-costra-154-r1-implement.md`
- 2026-05-19 · **COSTRA-158 R1 backend 段**（8 项 server 改动 A~G' · /users/me GET+PATCH+POST K3 兜底 · has_completed_profile 严格判定 · 闸门 G1~G6+G8/G13/G14 全绿 · 等 miniapp-dev 段统一 commit）· `history/2026-05-19-COSTRA-158-r1-backend.md`
- 2026-05-19 · **COSTRA-156 Human T1 APPROVED CLOSED**（联合 105 双卡终审 · D-022 v2.0 第 4 次实战 40/40 连续满分 · CI 对账族第 5 张规则 D 落地 · D-016 反例第 8 次首次预防成功）· `history/2026-05-19-COSTRA-156-final-approved.md`
- 2026-05-18 · COSTRA-105 R1.x.2 BUG-002 修复（sync/push payload UUID schema 校验补全 + T9 单测 · D-017 v3 §2.4 E1 例外路径）· SBAI 第 11 次冒烟
- 2026-05-18 · COSTRA-157 R1 backend 段（A 项 server defaults 抽取 + F 项 server 单测 · 等 miniapp-dev 接手统一 commit）· SBAI 第 10 次冒烟
- 2026-05-11 · COSTRA-104 R1 实装（POST /sync/push + POST/GET /entries + 3 stub 切出去铁律 · D-022 v2.0 第 2 次实战准备）· 6d395bd / 6c17085 / 212f181 · SBAI 第 8 次冒烟 · backend-dev 首次实战 · R1+R1.1+R1.2 三轮收口（D-016 反例第 5 次 · 由 Orchestrator 接管收尾）
- 2026-05-11 · COSTRA-104 R1.x 极窄修复（R1 review-tech 36/40 APPROVE 后同轮兑现 P1-1 + P2-1 · 补 T2 update conflict 测 + followup_id 字段名修正）· 363efa1 · SBAI 第 9 次冒烟 · backend-dev 第 2 次实战收口
- 2026-05-12 · COSTRA-104 R1.x.1 极窄修复（human curl 实测发现真实腾讯 code 阻塞 40029 · 加 dev WX_MOCK_LOGIN=1 mock 入口 · env.ts wxMockLogin + parseBool + dev-only 校验 + server.ts setWxFetchForTests 启动期注入 + .env.example 注释 + curl-verify.md v1.2）· 95e00c6 · backend-dev 第 3 次实战
- 2026-05-13 · COSTRA-156 R1 实装（server /v1 prefix + 24处inject改/v1 + healthz保根 + whitelist规则D + 文档同步104curl-verify v1.5 + 105手册 v1.3 + FU-105 closed）· D-022 v2.0 第 4 次实战 · 等 review-tech R1 APPROVE

## §4 最近决策影响

- `D-018 SBAI v1.1`
- `ADR-0002 Tech Stack`· Node/TS/Fastify（**权威 · 不是 Go**）
- `D-008 subject 个人优先企业兼容`· 实装 `server/src/config/subject.ts`
- `D-009 域名红线`· `costra.cloud` / 开发服务器 `49.235.216.20`（2026-07-23 到期）
- **D-020 D-016 升定稿**（COSTRA-104 R1+R1.1+R1.2 漏 commit 第 5 次反例 · Sprint-2 末 Retro 议题）
- **D-021 D-017 v3 升级**（三证铁律本卡实战）
- **D-022 v2.0 review-tech 评分表**（本卡 review-tech R1 = D-022 v2.0 第 4 次实战）
- **D-023 立案候选**：OpenAPI servers prefix 与 fastify register prefix 强制一致性规约（COSTRA-156 Sprint-2 Retro 议题 · 已在派单档 §9 标注）

## §5 工作区 + 权限

可写目录：`server/` / `server/api/openapi.yaml`（追加 x-deferred）/ `.team/members/backend-dev/`
禁写：其他目录（含 docs/api/ G3 协议 · server/db/migrations/ schema 锁定 · miniprogram/）

## §6 遗留问题 / FU / 债务

- 契约漂移风险（/sync/push 5 字段冲突解决策略已 G3 冻结 · COSTRA-100 closed）
- 金额精度 DECIMAL(18,4) + `decimal.js` 双端一致约束（已实装）
- COSTRA-104 切出去 3 件套铁律首次实战遗留（FU-104-ENTRIES-PATCH/DELETE/SYNC-PULL → COSTRA-152/153/154 Sprint-3 候选 · 152/153 Card-Review 双卡同轮闭环 · 等 R1 实装）
- **SBAI 装扮档 7 点卡需在 R1 内分阶段 commit 议题**（Sprint-2 末 Retro 必处置 · COSTRA-104 5 次反例确认）
- **D-016 反例第 8 次预防**（COSTRA-156 本卡 state/history 随 commit 同轮落盘 · 成功）
- 🆕 **R1.x.2 v1.2 协议升级 Sprint-3 末 Retro 议题候选**（议入 4 项）：
  1. 协议演化版本号变更条件（v1.x → v2.x 阈值 · 区别 doc-only sync 与破坏性 schema 升级）
  2. 微秒精度 vs 自增序列号在分布式时序上的取舍范式（本卡 Human 追问 "watermark 靠精度就能完美解决吗" 产物）
  3. pg-mem 测试基础设施补强（setval / timezone / to_char mock 沉淀公共 helper · 当前 `test/setup.ts` 内联）
  4. 联合实测 = 真闭环最后一道闸新范式（D-024 §2.2 C1 立意首次得到协议升级级别证据）
- 🆕 **COSTRA-152+153 Card-Review 暴露 Sprint-3 末 Retro 议题候选**（议入 2 项）：
  5. **service 层 user/family 守门作为 review-tech 强制审查维度**（COSTRA-104 R1 实装时漏写 entryService.findById 的 userId 过滤 · review-tech R1 36/40 APPROVE 也漏检 · 153 R2 卡审形式审才捕获 · 暴露盲区：路由参数 userId 接收但未实际使用是常见 review 漏检模式）· 候选 D-022 v2.0 评分表 C8（红线）增项 "service 层接收 userId 必须有实际使用证据"
  6. **version+1 显式 SET 规约**（pg-mem 不支持 trigger · entryRepo.updateEntryByVersion/softDeleteEntry 原注释误写"触发器自动 version+1" · 实际只有 updated_at 触发器 · 必须应用层显式 SET version = version + 1 · 候选写入 ADR）

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
- 2026-05-11T20:57:43+08:00 · COSTRA-104 R1.x 极窄修复收口（363efa1 · P1-1 T2 测 + P2-1 followup_id）
- 2026-05-12T12:52:05+08:00 · COSTRA-104 R1.x.1 极窄修复收口（95e00c6 · dev WX mock 入口）
- 2026-05-18T20:07:30+08:00 · COSTRA-105 R1.x.2 BUG-002 修复（sync/push payload UUID schema 校验补全）
- 2026-05-19T10:18:00+08:00 · COSTRA-158 R1 backend 段完成（8 项 server 改动 · 闸门全绿 · 等 miniapp-dev 段统一 commit）
- 2026-05-19T20:30:00+08:00 · COSTRA-154 R1 实装完成（9 项 scope · 49 测全绿 · 闸门 G1~G8+G15 全绿 · 等 review-tech R1）
- **2026-05-22T17:30:00+08:00 · COSTRA-154 R1.x.2 v1.2 协议升级完成**（commit `31fb893` · ISO 时间戳 → BIGINT change_seq · migration 0006 + entryRepo 显式 nextval + syncPullService BIGINT + pg-mem setval mock + sync-pull.test +T18/T19/T20 + openapi int64 · server 56/56 PASS · 等 Human staging 重启 + 再次联合实测）
- **2026-05-22T18:55:00+08:00 · COSTRA-152 + COSTRA-153 双卡 Card-Review 闭环**（D-014 同轮范式第 3 次 · 152 R1 PASS-WITH-FOLLOWUP 25/30 → R2 PASS 28/30 · 153 R1 REVISE 22/30 → R2 PASS-WITH-FOLLOWUP 26/30 · 11 项 FU 全落地 · §LINKAGE 决策 1 K3 + 决策 2 query `?version=N` 拍板 · R2 暴露真 P0 跨 family 越权守门盲区 · 等 R1 实装 spawn）
- **2026-05-22T19:00:00+08:00 · COSTRA-152 + COSTRA-153 双卡联合 R1 实装完成**（PATCH + DELETE + P0 守门补丁 + K3 + version+1 修复 · 70/70 测全绿 · 守门反向验证通过 · 双 commit 落盘 · 等 review-tech R1）
- **2026-05-23T16:15:00+08:00 · COSTRA-152 + COSTRA-153 Human T1 APPROVED CLOSED**（联合双卡同轮 approve · D-024 §2.2 C1 第 4 次实战完美收官 · 152 APPROVE 37/40 + 153 APPROVE 39/40 · curl 实测 5 硬断言 H1~H5 全 PASS · 双 FINAL.md 落档 · Sprint-3 头部 4/9 卡 CLOSED · 估点 15/29 = 52%）
- **2026-05-27T15:30:00+08:00 · COSTRA-164 R1 实装完成**（dispatch v2.1 全 6 项 scope 落地 · 80/80 测全绿 · DoD 22/23 通过 · G15 反例命中：subagent 完成代码但漏 commit/state/history 归档 · Orchestrator 接管收尾 · Sprint-2 末 retro 议题"SBAI 装扮档 7 点卡需在 R1 内分阶段 commit"实战预警第 N 次 · 落 ADR-0007 v1.1 方案 R · migration 0007 family_kind ENUM + partial unique index · familyRepo + ledgerRepo 新建 + softDelete kind 守门 · authService withTx + isUniqueViolation + race fallback · AuthTokenPair +2 字段 · ErrorCode FAMILY_PERSONAL_NOT_DELETABLE · 等 review-tech R1 / 与 165 联合 approve）
