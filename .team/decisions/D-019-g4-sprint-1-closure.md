# D-019 · G4 闸门 · Sprint-1 收官决议 + Sprint-2 立卡锚点

- 日期：2026-05-09 09:42
- 提案人：Orchestrator（本会话）
- 审批人：Human（同对话轮 09:44 "按推荐的来"）
- 立案状态：✅ **Human approve @ 2026-05-09 09:44**（路径 A · Sprint-1 末 G4 合并闸门放行 + Sprint-2 立卡）
- 替代范围：无 · 本决议为 G4 闸门唯一落盘锚点
- 关联：HANDOFF.md §1.3 / board.md §🚦闸门状态 / `.team/decisions/D-013` / `.team/decisions/D-018-spawn-based-agent-isolation.md` / SOP-REVIEW

---

## §1 背景

Sprint-1 周期 2026-04-23 ~ 2026-05-06（标准 2 周 · **实际 2026-04-23 ~ 2026-05-08 · 超期 2 天**）。

**主线兑现**：

| 维度 | 卡 | 状态 |
|---|---|---|
| 主线 | COSTRA-102（MiniApp 登录→首页→记一笔端到端） | ✅ Human T1 APPROVED CLOSED @ 2026-05-08 19:11 |
| 基建 | COSTRA-100 / 101 / 115 / 116 | ✅ 全 CLOSED |
| 同族规约盲区 5 连 | COSTRA-119 / 120 / 121 / 122 / 123 | ✅ 全 CLOSED |
| 启动期治理 5 卡（FU-LAUNCH 族） | COSTRA-124 / 125 / 126 / 127 / 128 | ✅ 5 卡合并 Human T2 APPROVED CLOSED @ 2026-05-08 19:11 |
| 审计 | COSTRA-118 | ✅ CLOSED |

**Sprint-1 总估点定稿**：**52 点**（原 40 + 紧急卡五连 8 点 + 启动期治理 5 卡 4 点 = 52）· 较初始 40 点溢出 30%（议题 #19 · 紧急卡五连溢出 40 工时顶格约束）。

**未触发**：COSTRA-114（DevOps bootstrap 手册）· 卡定义已 approve · 实际未开工 · 转 Sprint-2 候选。

---

## §2 G4 决议（路径 A）

### §2.1 Sprint-1 收官放行

✅ **Sprint-1 14 卡 100% CLOSED · Sprint-1 主线达成 · G4 合并闸门 PASS · 主线分支可进入 Sprint-2**。

放行依据：

1. 主线 COSTRA-102 Human T1 实测兑现（Mock + 本地 server 双模式 · 真 staging 留 Sprint-2 提审前）
2. 启动期治理 5 卡（124~128）4 次定性翻转 v1→v5 · v5 唯一定稿存于 `docs/devops/libversion-upgrade.md §3.4`
3. 同族规约盲区 5 连闭环（119~123）+ CI 对账族从 1 扩到 3（whitelist + appjson + tooling）
4. 0 残余 P0/P1 阻塞 · 0 红线违反 · 0 在办卡

### §2.2 残余议题处置（路径 A · 转 Sprint-2 头部 Retro 卡 COSTRA-106）

议题 10/11/12/13/14/15/16/17 + 紧急卡五连溢出 + D-016 升定稿规约 + D-017 v1→v3 升级合计 14+ 条议题 **不在 G4 决议内修订规约**（避免决议体量膨胀 + 规约改动需独立 review）· 全部转入 Sprint-2 头部 **COSTRA-106 Sprint-1 Retro 卡**（估 1 点 · Sprint-2 第 1 张 · 见 §3.2）。

议题清单见 HANDOFF.md §6.1 + `.team/reviews/COSTRA-128/FINAL.md`（已落盘 · 不会丢）。

### §2.3 残余 FU 处置

| FU 类型 | 处置 |
|---|---|
| FU-LAUNCH 族（A/B/C） | ✅ 已全 closed @ COSTRA-127（2026-05-08 17:55 · Human 实测兑现）|
| FU-102-* 5 条（FU-102-ERROR-MAPPER-INTEGRATION / FU-102-AVATAR-ONERROR / FU-102-PROFILE-REFUSE-UI / FU-COMMON-MINIAPP-PATCH-LIMIT / FU-102-SYNC-PULL-DRIFT） | 全 `open` · 转 Sprint-2 · FU-102-SYNC-PULL-DRIFT 优先级最高（议题 11 旁证）|
| FU-DB-OPS-AUDIT | `open` · 转 Sprint-2+ · Backend-Agent 主驾 · 触发条件 = DAU > 100 或 Sprint-2+ DBA 体检窗口 |
| FU-LIBVERSION-DEV-GUARD | `open` · 转 Sprint-2 · DevOps + miniapp-dev 协同 · 微信基础库版本跃迁守门 |
| FU-CI-MP-BUILD-NPM-ENFORCE | `open` · 转 Sprint-2 · 候选并入 Sprint-2 DevOps 基建卡 |
| FU-REVIEW-TECH-RUNTIME-DIM | `open` · 议题 #13 · 由 COSTRA-106 Retro 处理 |
| FU-124-P2-1/2/3 / FU-125-P2-1~4 | `open` · dispatch 元数据层 · 转 COSTRA-106 Retro 议题 #19 子项 |
| FU-001 / FU-118-2/3/4/5 | `open` · 转 Sprint-2 候选（FU-118-3 升 COSTRA-160 设计-实装 pipeline · FU-001 + FU-118-2 合并入 Epic-F 用户资料卡）|

完整 FU 索引见 `.team/follow-ups/README.md`。

### §2.4 G4 不放行项 → G5 留置

- **真 staging 验证**（COSTRA-102 方式 C · `api.costra.cloud` 白名单）：等 ICP 备案下证 + 白名单配置完成 · Sprint-2 提审前复跑手册步骤 1/2/5 · R-013 关闭条件
- **G5 发布闸门**：仍 Preempt-Ready · 占位流水线就绪 · 等 ICP + 主体定型 + 真 staging 实测三件套齐
- **微信审核首次提审**：Sprint-2 末 / Sprint-3 早期窗口 · 取决于 Epic-C/D/E 完成度

---

## §3 Sprint-2 立卡锚点

### §3.1 Sprint-2 周期 + 范围

- **周期**：**2026-05-10（周日）~ 2026-05-23（周六）**（标准 2 周 · 节奏拉回 · 议题 #19 教训：紧急卡溢出风险下不再额外缓冲）
- **总估点目标**：**32~36 点**（保守 · 留 4~6 点紧急卡 buffer · 议题 #19 直接证据驱动）
- **主线**：Epic-C 本地持久化 + 同步通道（COSTRA-103 + 104）
- **次线**：Sprint-1 残债清算 + Epic-G 提审准备启动

### §3.2 Sprint-2 卡清单（建议 · 待 Human 立卡触发）

| 卡号 | 标题 | Owner | 估点 | 优先级 | 依赖 | 备注 |
|---|---|---|---|---|---|---|
| **COSTRA-106** | **Sprint-1 Retro · 14+ 议题处置 + 工程度量刷新** | PM-Agent | 1 | P0（Sprint-2 第 1 张） | — | G4 决议第 1 张衍生卡 · 议题 10~17 + D-016 升定稿 + D-017 v3 升级 + 紧急卡五连溢出复盘 |
| **COSTRA-103** | **本地 SQLite/IndexedDB 持久化 + outbox_queue**（Epic-C 主线）| MiniApp-Agent | 5 | P0（Sprint-2 主线）| COSTRA-100 | Sprint-1 已解锁 · D-013 T1/T2 双轨 · 含离线写入 + outbox 重放 + 冲突探测桩 |
| COSTRA-104 | `/entries` CRUD + `/sync/push` 批量通道 | Backend-Agent | 6 | P0 | COSTRA-100 / 103 | 与 103 协议对齐 · 走 ErrorCode 枚举 + idempotency_keys |
| COSTRA-105 | 单人记账闭环冒烟（含离线弱网）| QA-Agent | 3 | P1 | COSTRA-103 / 104 | 端到端冒烟 · Sprint-2 中段 |
| COSTRA-112 | `miniprogram/config/subject.ts` + 硬编码主体字样清扫 | MiniApp-Agent | 1 | P1 | D-008 | 与 113 对齐 · 主体红线最后一公里 |
| COSTRA-114 | 开发服务器 bootstrap 手册（SSH 加固/防火墙/docker/nginx+自签 HTTPS）| DevOps-Agent | 2 | P2 | D-009 | Sprint-1 未开工 · 转入 |
| COSTRA-160（暂号）| miniapp 设计 tokens pipeline（FU-118-3 根治）| Design-Agent + MiniApp-Agent | 2 | P2 | COSTRA-011 | 构建脚本 `scripts/gen-wxss-tokens.mjs` · 设计-实装闭环 |

**Sprint-2 总估点（建议）**：1 + 5 + 6 + 3 + 1 + 2 + 2 = **20 点 + 紧急卡 buffer 12~16 点 = 32~36 点**

**立卡顺序建议**：

1. **第 1 张 · COSTRA-106**（Retro）· 立即开 · 半天卡 · 议题热度未消
2. **第 2 张 · COSTRA-103**（主线）· COSTRA-106 完成后立即开 · Sprint-2 重头戏
3. **第 3 张 · COSTRA-104**（后端协议）· 与 103 串行（103 完工后开）
4. 之后按 105 → 112 → 114 → 160 顺位 · 其中 112 / 114 / 160 可与主线并行（不同 Owner）

### §3.3 Sprint-2 不在范围（明确剔除 · 避免 scope creep）

- **Epic-D 家庭共享**（含邀请码 + 微信分享 + 订阅消息）→ Sprint-3
- **Epic-E 预算 / 周期账单** → Sprint-3
- **Epic-F 报表 + 用户资料完善** → Sprint-3 / Sprint-4
- **真实 miniprogram-ci 上传演练**（COSTRA-108）→ Sprint-2 末或 Sprint-3 头（取决于 ICP 进度）
- **真 staging 验证** → 等 ICP 下证 + 白名单 · 不立卡 · 走 R-013 关闭条件

---

## §4 commits + 度量

### §4.1 Sprint-1 累计 commits

26 commits 已 push origin/dev（HANDOFF v1.3 落盘 commit `8c93c73` 为最新 HEAD · 含本决议提交将达 27 commits）· 详见 HANDOFF.md §5。

### §4.2 工程度量

- **Review 通过率**：Sprint-1 累计 14 卡 AI-Review 全 PASS · 0 ESCALATE · 平均分 32.5/35（Tech）+ 28/30（Product）
- **Human 终审通过率**：14/14 · 100%
- **D-016 同轮兑现**：累计 12 次实战 · 0 跨轮异步反模式 · **Sprint-2 升定稿规约**（议题 #19 子项 · COSTRA-106 处置）
- **D-017 实战**：5 次实战 · v1→v3 升级证据完整（COSTRA-120/121/122/123/124 实战）
- **SBAI v1.1 冒烟**：5 次 miniapp-dev 实战 + 1 次 card-reviewer-tech 实战 · 审查档物理只读纪律 100% 通过
- **CI 对账族**：1 → 3（whitelist + appjson + tooling）· Rule 数量 0 → 8 条（5a/5b/5c 三子规约属 tooling）

---

## §5 Human 后续动作（按优先级）

1. **🟢 立即可做**：触发 Sprint-2 第 1 张卡 = `run pm COSTRA-106`（Sprint-1 Retro · 1 点 · 半天）
2. **🟢 接续**：触发 Sprint-2 主线 = `run miniapp COSTRA-103`（本地持久化 · 5 点 · Sprint-2 主头）
3. **🟢 被动等**：ICP 备案首审短信（3~5 日窗口仍开）/ 订阅消息文案 v0.1 / 隐私指引清单
4. **🟡 ICP 下证日（估 5 月中下旬）**：配 `api.costra.cloud` 微信白名单 → 发 `close:R-013` → 真 staging 实测开窗

---

## §6 决议生效

- ✅ Human approve @ 2026-05-09 09:44（路径 A · "按推荐的来"）
- ✅ G4 闸门状态：⏳ Sprint-1 末 → ✅ **PASS @ 2026-05-09 09:44**
- ✅ Sprint-1 状态：🟢 启动中 → ✅ **收官 @ 2026-05-09 09:44**
- ✅ Sprint-2 状态：未启动 → ⏳ **Planning 中**（等 Human 触发 COSTRA-106 立卡）
- 本决议落盘后 board.md §🚦闸门状态 + Sprint 历史 + Orchestrator 状态同轮刷新（HANDOFF v1.4 同轮刷新）

---

**本决议由 Orchestrator 在 G4 决策瞬间落盘 · 同轮刷新 HANDOFF + board · 不再修改**（如有调整 · 立 D-020 增量决议）。
