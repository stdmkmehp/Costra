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

- （无 · COSTRA-104 R1.x.1 完成 · 等 review-tech R1.x.1 review）

## §3 交付历史索引

- 2026-05-11 · COSTRA-104 R1 实装（POST /sync/push + POST/GET /entries + 3 stub 切出去铁律 · D-022 v2.0 第 2 次实战准备）· 6d395bd / 6c17085 / 212f181 · SBAI 第 8 次冒烟 · backend-dev 首次实战 · R1+R1.1+R1.2 三轮收口（D-016 反例第 5 次 · 由 Orchestrator 接管收尾）
- 2026-05-11 · COSTRA-104 R1.x 极窄修复（R1 review-tech 36/40 APPROVE 后同轮兑现 P1-1 + P2-1 · 补 T2 update conflict 测 + followup_id 字段名修正）· 363efa1 · SBAI 第 9 次冒烟 · backend-dev 第 2 次实战收口
- 2026-05-12 · COSTRA-104 R1.x.1 极窄修复（human curl 实测发现真实腾讯 code 阻塞 40029 · 加 dev WX_MOCK_LOGIN=1 mock 入口 · env.ts wxMockLogin + parseBool + dev-only 校验 + server.ts setWxFetchForTests 启动期注入 + .env.example 注释 + curl-verify.md v1.2）· 95e00c6 · backend-dev 第 3 次实战

## §4 最近决策影响

- `D-018 SBAI v1.1`
- `ADR-0002 Tech Stack`· Node/TS/Fastify（**权威 · 不是 Go**）
- `D-008 subject 个人优先企业兼容`· 实装 `server/src/config/subject.ts`
- `D-009 域名红线`· `costra.cloud` / 开发服务器 `49.235.216.20`（2026-07-23 到期）
- **D-020 D-016 升定稿**（COSTRA-104 R1+R1.1+R1.2 漏 commit 第 5 次反例 · Sprint-2 末 Retro 议题）
- **D-021 D-017 v3 升级**（三证铁律本卡实战）
- **D-022 v2.0 review-tech 评分表**（本卡 review-tech R1 = D-022 v2.0 第 2 次实战）

## §5 工作区 + 权限

可写目录：`server/` / `server/api/openapi.yaml`（追加 x-deferred）/ `.team/members/backend-dev/`
禁写：其他目录（含 docs/api/ G3 协议 · server/db/migrations/ schema 锁定 · miniprogram/）

## §6 遗留问题 / FU / 债务

- 契约漂移风险（/sync/push 5 字段冲突解决策略已 G3 冻结 · COSTRA-100 closed）
- 金额精度 DECIMAL(18,4) + `decimal.js` 双端一致约束（已实装）
- COSTRA-104 切出去 3 件套铁律首次实战遗留（FU-104-ENTRIES-PATCH/DELETE/SYNC-PULL → COSTRA-152/153/154 Sprint-3 候选）
- **SBAI 装扮档 7 点卡需在 R1 内分阶段 commit 议题**（Sprint-2 末 Retro 必处置 · COSTRA-104 5 次反例确认）

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
- 2026-05-11T20:57:43+08:00 · COSTRA-104 R1.x 极窄修复收口（363efa1 · P1-1 T2 测 + P2-1 followup_id）
- 2026-05-12T12:52:05+08:00 · COSTRA-104 R1.x.1 极窄修复收口（95e00c6 · dev WX mock 入口）
