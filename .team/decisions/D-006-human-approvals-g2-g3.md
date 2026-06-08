# D-006 · Human 决策批复：命名风格 / 冲突策略 / session 时长 / G2+G3 approve

- **决策者**：Human
- **记录人**：Orchestrator
- **时间**：2026-04-22 16:47
- **关联闸门**：G2（Design Review）· G3（Contract Sign-off）
- **关联卡片**：COSTRA-010 / COSTRA-011 / COSTRA-020 / COSTRA-021 / COSTRA-030 / COSTRA-040 / COSTRA-050

---

## 1. 字段命名风格

| 维度 | 决策 | 执行位置 |
|---|---|---|
| 传输层（HTTP/JSON） | `snake_case` | `api/openapi.yaml` · `server/**` |
| 客户端业务层（TS/JS） | `camelCase` | `miniprogram/**` |
| 双向映射 | 由 `miniprogram/utils/request.ts` 自动转换 | 已有占位，后续 Sprint-1 实装 |

**理由**：
- 对齐业界最常见分工（后端 snake / 前端 camel），双方都用各自语言的习惯写法
- 在 request 层集中映射，业务代码无需感知
- 对 OpenAPI 生成的 TS 类型不产生破坏（codegen 侧已考虑）

**影响范围**：无需对已有 artifact 做大改，`docs/api/README.md §1` 现状即为此方案。

---

## 2. 多端同步冲突策略

**采纳现有方案**：
> 乐观锁（version 字段）+ `Idempotency-Key` 请求去重 + 分层合并规则（静默 / 字段级 / Toast / 用户面板）+ 审计日志

**关键结论**（见对话推导）：
- **新建（INSERT）永不冲突** —— 覆盖 ~85% 写操作
- **修改/删除才走 version 判断** —— 覆盖 ~15% 写操作
- **用户感知冲突率 ≈ 0.2%~0.5%**，远低于痛点阈值
- **离线攒单 + 批量推送** 由 `/sync/push` 批通道承接，不破坏任何 id 唯一性

**后续 Sprint-2 增强**（非 MVP 阻塞）：
- "@家庭成员正在编辑" 实时提示，从源头降低并发修改概率

---

## 3. Session / Token 有效期

| Token | 有效期 | 作用 |
|---|---|---|
| `access_token` | **2 小时** | 每次 API 调用携带 |
| `refresh_token` | **30 天** | 仅用于 `/auth/refresh` 换新 access |
| `wx_session_key` | ~3 天（微信侧） | 登录换凭证，一次性 |

**刷新策略**：access 过期前 5 分钟静默刷新；401 时自动刷一次失败则清凭证跳登录。
**登出**：`/auth/logout` 立即使 refresh 失效。

**结论**：Human 认可现有方案。

---

## 4. G2 / G3 批准决议

| 闸门 | 卡片 | 决议 |
|---|---|---|
| **G2 设计评审** | COSTRA-010 信息架构 + 故事地图 | ✅ Approved |
| | COSTRA-011 设计系统 + 分享卡 | ✅ Approved |
| **G3 契约双签** | COSTRA-020 OpenAPI + 错误/冲突/审计 | ✅ Approved（**带补齐项**，见 §5） |
| | COSTRA-021 DB Schema + docker-compose | ✅ Approved |
| **同步批准** | COSTRA-030 MiniApp 骨架 | ✅ Approved（Mock 登录闭环受认可，真实联调转 Sprint-1） |
| | COSTRA-040 CI/CD 占位流水线 | ✅ Approved（真实上传链路等外部资源到位后激活） |
| | COSTRA-050 QA 策略 + 冒烟 + 微信审核自查 | ✅ Approved |

**效果**：Sprint-0 7 张卡全部流转到 Done；闸门 G2 / G3 均置 Approved。

---

## 5. G3 带条件 approve 的补齐项（入 Sprint-1 首日）

> 本次 approve 采用 "approve with follow-up" 模式，不阻塞 Sprint-1 启动，但下列 5 项必须在 Sprint-1 第 1 个工作日内由 Backend-Agent 产出。

| # | 缺口 | 交付物 | 严重度 |
|---|---|---|---|
| 1 | 错误码表独立成文 | `docs/api/error-codes.md` | 🔴 P0 |
| 2 | OpenAPI 显式 `ErrorCode` 枚举 | `api/openapi.yaml` 增补 | 🔴 P0 |
| 3 | OpenAPI 登录/刷新响应 `*_ttl` 字段 | `api/openapi.yaml` 增补 | 🟠 P1 |
| 4 | ID 生成规范 | `docs/api/id-strategy.md`（ULID + 幂等） | 🟠 P1 |
| 5 | 批量同步协议 | `docs/api/sync-protocol.md`（`/sync/push` 细节） | 🟠 P1 |

派工指令：见 `.team/messages/2026-04-22.jsonl` 中 Backend-Agent 条目。

---

## 6. 传递到看板 / 后续 Sprint 的副作用

- 看板：7 卡 Review → Done；G2 / G3 闸门 → Approved
- Sprint-0 宣告收官，`.team/sprints/sprint-00-retro.md` 由 PM-Agent 在 Sprint-1 启动前补
- Sprint-1 计划以此批准为前提，立即激活（见 `.team/sprints/sprint-01-plan.md`）

---

_本决策文件作为 G2 / G3 闸门的正式批件存档，在任何 retro / 审计场景下具备溯源效力。_
