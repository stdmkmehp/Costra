# Costra · Cross-Session Handoff Anchor

> **用途**：新会话接续 Costra 项目时 · Orchestrator（CodeBuddy 装扮）只需 **Read 本文件** 即可 100% 接上进度 · 无需翻遍 `.team/`。
>
> **维护约定**：本文件由当前会话的 Orchestrator 在**每次重大节点**（卡立/Review PASS/FU 闭合/Sprint 转段/决议落地）**同对话轮**更新 §1 + §3 + §6 + §7。Human 无需主动维护，但 Human 可随时要求 Orchestrator 刷新。
>
> **文件纪律**：
> - 禁止删节 §0-§8 骨架（只改节内内容）
> - 版本 bump 走 §8 版本表（极小改动仅改 §1 时间戳可以不 bump）
> - 本文件本身由本会话 @ 2026-05-03 12:41 立案（随 COSTRA-124 Review 末端节点）

---

## §0 一句话断点（HEAD 之前 = 已兑现 · 之后 = 待做）

> **2026-05-23 21:10 当前断点**：📋 **路径 α Phase-1 prod-bootstrap.md v1.0→v1.1 修订**（Human 反馈 2 条调整：① OS 是 tlinux3.3 不是 Debian/Ubuntu · ② PG + Redis 改本地原生安装不用 docker compose）· readiness-checklist v1.0→v1.1 闸门 4 同步从 1 个 service 改 4 个 systemd service · **等 Human SSH 49.235.216.20 跑 prod-bootstrap §1~§8 v1.1 · 预计 75~120 min**（比 v1.0 多 ~30 min · dnf 装 PG/Redis 多步骤）
>
> **v1.1 主要变化**（vs v1.0）：
> - **OS 校准**：tlinux3.3 = 腾讯定制 RHEL/CentOS Stream 8 · dnf 包管理 / firewalld / SELinux / RHEL 系 nginx 目录
> - **§1.1 工具补装**：apt → dnf · 加 PGDG-EL8 仓装 PG 15 + EPEL 仓装 Redis 7 + NodeSource 仓装 Node 20
> - **§3 整段重写**：从 docker compose（4 服务）改 PG 15 本地原生 + Redis 7 本地原生 · 含 initdb + pg_hba 配 SCRAM + Redis bind 127.0.0.1 + AOF + 密码 + maxmemory · 加 §3.4 强密码生成统一指引（PG/Redis/JWT 三独立密码）
> - **§4.1 修正**：DATABASE_URL 用 127.0.0.1（不是 localhost）· REDIS_URL 加密码 `redis://:PW@host`
> - **§5.1 修正**：systemd After/Requires 从 docker.service 改 postgresql-15.service + redis.service（依赖链对齐）
> - **§6.1 步骤 2 修正**：DATABASE_URL → DB_URL（migrate.sh:13 实际用此名 · 命名错配修复）
> - **§7 修正**：nginx 配置路径从 sites-available/sites-enabled 改 conf.d/（RHEL 系标准）
> - **§8 闸门 4 调整**：从 1 个 service（costra-server）改 4 个（postgresql-15 / redis / costra-server / nginx）
> - **§9 FAQ**：6 条→8 条 · 加 Q6 Redis · Q8 SELinux/firewalld（tlinux 特有踩坑）
> - **§10 FU**：7 条 13pt → 9 条 15pt · 加 FU-PROD-PG-TUNE + FU-PROD-SCHEMA-MIGRATIONS-TABLE
> - **§11 时间**：65min → 95min（± 30min）
>
> **本对话轮路径 α 6 阶段切片**：
> - **Phase-0**（已完成）：D-026 立档 + risks.md R-020 状态升 Accepted-Sprint-3-to-5 + domains.md §1.1 staging 注释扩展
> - **Phase-1**（手册 v1.1 已交付 · 等 Human 跑）：`infra/prod-bootstrap.md` v1.1（**~700 行 · tlinux3.3 + 本地 PG/Redis**）+ `infra/wechat/prod-readiness-checklist.md` v1.1（~110 行 · Phase-2 闸门 5 条速查 · 闸门 4 改 4 svc）
> - **Phase-2**（等 Phase-1 完成）：5 闸门验证（healthz / icp / 401 守门 / **4 svc systemd** / **C2 mock 红线 grep**）
> - **Phase-3**（等 Phase-2 PASS）：154+150 真 prod 实测——派 qa-planner 改 `qa/costra-154-150-joint-smoke.md` v1.3→v1.4 prod 版（移除 WX_MOCK_LOGIN + 切真 wx.login + apiBaseUrl prod）
> - **Phase-4**（等 Phase-3 完成）：152+153 prod 回归——派 qa-planner 改 `docs/qa/costra-152-153-curl-verify.md` v1.0→v1.1 prod 版
> - **Phase-5**（等 Phase-3+4 全 PASS）：联合双卡 approve `approve:COSTRA-154 + COSTRA-150` · Sprint-3 头部 6/9 = 83% · 当对话轮 closure commit
>
> **D-026 §2.3 工程纪律 4 条**（Sprint-3~Sprint-5 期硬约束 · 违反 → R-020 升 🟡→🟠 强制重启子域）：
> - **C1 灰度/实验隔离**：严禁 staging-only feature flag / 灰度名单（违反 → 触发 §2.4 (α)）
> - **C2 mock 通道防护**（最严）：`WX_MOCK_LOGIN=0` 必须显式设 systemd EnvironmentFile + 启动日志验证 + CI 红灯（FU-PROD-CI-MOCK-GUARD P0 1pt 候选立卡）· 关联 R-008 极高红线
> - **C3 prod DB 操作三件套**：dump → operate → verify · 任何 DELETE/TRUNCATE/DROP/migration 需 Human 拍板
> - **C4 测试数据隔离**：用预留 family_id `00000000-...0F0` + ledger `...001` · 不污染真实用户数据
>
> **D-026 §2.4 重启硬触发 4 条**（αβγδ）：
> - (α) P0 真实用户灰度名单需要分流
> - (β) P1 prod entries > 10 万条
> - (γ) P0 Sprint-6 公测准备（M5 观察期前必须）
> - (δ) P0+ R-008 类安全事件
>
> **本轮事故记录**（议入 Sprint-3 末 Retro · 议题 #6 候选）：
> - **SBAI v1.1 装扮档 spawn 工具白名单平台限制**：`task(subagent_name="code-explorer", prompt=...)` 路径 spawn 的 pm-writer / devops-ops 装扮档继承的是 code-explorer 的只读工具集（无 write_to_file / replace_in_file）· 与 COMMON-CONTRACT §0-Bis 装扮档授权口径错配 · 两 subagent final message 还被工具平台截断（>14k chars + >23k chars · 命中 HANDOFF v1.21 §0 已知教训）· 历史先例（D-019/D-021/D-022/D-023 落盘）支持 Orchestrator 兜底落档兼容路径 · 候选 D-027 平台升级触发条件 / D-018 §3.5 v1.0 既定事实加注
>
> **下一步推荐路径**（按 Human 时间窗）：
> 1. **🟡 立即可做**：Human 启 Phase-1 SSH 49.235.216.20 跑 `infra/prod-bootstrap.md` v1.1 §1~§8（**75~120 min** · 含 §2.1 仓库 URL 拍板 + §3.4 三个独立强密码生成 + §4.2 WX_APP_SECRET 取得 + §7.3 Let's Encrypt 邮箱）
> 2. **🟢 Phase-2 跑完后**：贴 5 条闸门 PASS/FAIL 反馈 → Orchestrator 同对话轮派 qa-planner 出 Phase-3 改造手册
>
> （上一断点归档）2026-05-23 20:30：📋 **路径 α 完整版启动 · D-026 立档 + Phase-1 prod-bootstrap.md v1.0 落档**（已被 v1.1 修订替代）

---

## §0-bis 历史断点归档（按时间倒序）

> （v1.22 之前断点已迁移至本节归档区 · 保留全文不删）

> **2026-05-23 16:20 历史断点**：🏆🏆 **COSTRA-152 + COSTRA-153 双卡 Human T1 APPROVED CLOSED · D-024 §2.2 C1 第 4 次实战完美收官**（105+156 / 157+158 / 154+150 / **152+153** 四连）· Sprint-3 头部 4/9 卡 CLOSED · 估点 15/29 = **52%**
>
> **本对话轮路径 α 6 阶段切片**：
> - **Phase-0**（已完成）：D-026 立档 + risks.md R-020 状态升 Accepted-Sprint-3-to-5 + domains.md §1.1 staging 注释扩展
> - **Phase-1**（已交付手册 · 等 Human 跑）：`infra/prod-bootstrap.md` v1.0（530 行）+ `infra/wechat/prod-readiness-checklist.md` v1.0（85 行 · Phase-2 闸门 5 条速查）
> - **Phase-2**（等 Phase-1 完成）：5 闸门验证（healthz / icp / 401 守门 / systemd / **C2 mock 红线 grep**）
> - **Phase-3**（等 Phase-2 PASS）：154+150 真 prod 实测——派 qa-planner 改 `qa/costra-154-150-joint-smoke.md` v1.3→v1.4 prod 版（移除 WX_MOCK_LOGIN + 切真 wx.login + apiBaseUrl prod）
> - **Phase-4**（等 Phase-3 完成）：152+153 prod 回归——派 qa-planner 改 `docs/qa/costra-152-153-curl-verify.md` v1.0→v1.1 prod 版
> - **Phase-5**（等 Phase-3+4 全 PASS）：联合双卡 approve `approve:COSTRA-154 + COSTRA-150` · Sprint-3 头部 6/9 = 83% · 当对话轮 closure commit
>
> **D-026 §2.3 工程纪律 4 条**（Sprint-3~Sprint-5 期硬约束 · 违反 → R-020 升 🟡→🟠 强制重启子域）：
> - **C1 灰度/实验隔离**：严禁 staging-only feature flag / 灰度名单（违反 → 触发 §2.4 (α)）
> - **C2 mock 通道防护**（最严）：`WX_MOCK_LOGIN=0` 必须显式设 systemd EnvironmentFile + 启动日志验证 + CI 红灯（FU-PROD-CI-MOCK-GUARD P0 1pt 候选立卡）· 关联 R-008 极高红线
> - **C3 prod DB 操作三件套**：dump → operate → verify · 任何 DELETE/TRUNCATE/DROP/migration 需 Human 拍板
> - **C4 测试数据隔离**：用预留 family_id `00000000-...0F0` + ledger `...001` · 不污染真实用户数据
>
> **D-026 §2.4 重启硬触发 4 条**（αβγδ）：
> - (α) P0 真实用户灰度名单需要分流
> - (β) P1 prod entries > 10 万条
> - (γ) P0 Sprint-6 公测准备（M5 观察期前必须）
> - (δ) P0+ R-008 类安全事件
>
> **本轮事故记录**（议入 Sprint-3 末 Retro · 议题 #6 候选）：
> - **SBAI v1.1 装扮档 spawn 工具白名单平台限制**：`task(subagent_name="code-explorer", prompt=...)` 路径 spawn 的 pm-writer / devops-ops 装扮档继承的是 code-explorer 的只读工具集（无 write_to_file / replace_in_file）· 与 COMMON-CONTRACT §0-Bis 装扮档授权口径错配 · 两 subagent final message 还被工具平台截断（>14k chars + >23k chars · 命中 HANDOFF v1.21 §0 已知教训）· 历史先例（D-019/D-021/D-022/D-023 落盘）支持 Orchestrator 兜底落档兼容路径 · 候选 D-027 平台升级触发条件 / D-018 §3.5 v1.0 既定事实加注
>
> **本轮交付清单**（7 文件 · Orchestrator 兜底落档 · 待落 commit）：
> - 新建：`.team/decisions/D-026-staging-prod-merged-acceptance.md`（~220 行 · 决议主体）
> - 新建：`infra/prod-bootstrap.md`（~530 行 · Phase-1 部署手册）
> - 新建：`infra/wechat/prod-readiness-checklist.md`（~85 行 · Phase-2 闸门速查）
> - 编辑：`.team/risks.md` R-020 行（mitigation 列尾追加 D-026 §2.3 + 状态升 Accepted-Sprint-3-to-5）
> - 编辑：`infra/wechat/domains.md` §1.1 staging 行（注释列尾追加 D-026 §2.1）
> - 编辑：`.team/members/devops-ops/state.md` §2/§3/§4/§6/§7（含 §10 后续 7 条 FU 候选 13pt 进 Sprint-4）
> - 编辑：`.team/members/pm-writer/state.md` §2/§3/§4/§7（D-026 立档登记）
>
> **下一步推荐路径**（按 Human 时间窗）：
> 1. **🟡 立即可做**：Human 确认 D-026 §2.3 工程纪律 4 条接受（在对话回 OK 即可）
> 2. **🟡 接续做**：Human 启 Phase-1 SSH 49.235.216.20 跑 `infra/prod-bootstrap.md` §1~§8（60~90 min · 含 §2.1 仓库 URL 拍板 + §3.1 Postgres 强密码生成 + §4.2 WX_APP_SECRET 取得 + §7.3 Let's Encrypt 邮箱）
> 3. **🟢 Phase-2 跑完后**：贴 5 条闸门 PASS/FAIL 反馈 → Orchestrator 同对话轮派 qa-planner 出 Phase-3 改造手册
>
> （上一断点归档）2026-05-23 16:20：🏆🏆 **COSTRA-152 + COSTRA-153 双卡 Human T1 APPROVED CLOSED · D-024 §2.2 C1 第 4 次实战完美收官**（已收官）

---

## §0-bis 历史断点归档（按时间倒序）

> （v1.22 之前断点已迁移至本节归档区 · 保留全文不删）

> **2026-05-23 16:20 历史断点**：🏆🏆 **COSTRA-152 + COSTRA-153 双卡 Human T1 APPROVED CLOSED · D-024 §2.2 C1 第 4 次实战完美收官**（105+156 / 157+158 / 154+150 / **152+153** 四连）· Sprint-3 头部 4/9 卡 CLOSED · 估点 15/29 = **52%**
>
> **本对话轮总产出**（跨两次会话 · 7 commits 已 push origin/dev · 26 commits 累计）：
> - 昨日 5 commits（`db7affa` Card-Review · `513dd5a` 152 R1 + P0 守门 · `ccd80b9` 153 R1 · `167bf17` R1.x.1 双胞胎 · `0e7215a` HANDOFF v1.21 编排）
> - 今日 2 commits（`cfdb6e1` curl-verify 手册 v1.0 · 本编排层 commit closure）
>
> **Human T1 实测 + approve 链路**：
> - 实测手册 `docs/qa/costra-152-153-curl-verify.md` v1.0（746 行 · qa-planner 装扮档产出）
> - 不依赖 staging（本地 server + WX_MOCK_LOGIN=1）· 与 154+150 staging 重测路径解耦
> - 5 硬断言 H1~H5 全 PASS @ 16:15
> - 联合双卡同轮 approve（D-014 SOP）一次关 2 张卡
>
> **范式累计**（本轮巩固 + 新增）：
> - **D-014 同轮范式第 3 次完美收官**：105+156 → 154+150 → **152+153** 三连
> - **D-016 100% 修订率连续第 7~8 张**（累计 105+156+158+154+150+152+153）
> - **D-017 v3 §2.4 E1 极窄修复第 10+11 次实战**（双胞胎 P1 同 commit）
> - **D-022 v2.0 第 9+10 次实战**（37+39 双高位 · 评分稳定）
> - **D-024 §2.2 C1 攒批第 4 次实战完美收官**
> - **D-025 AP-003 第 4+5 次正向兑现**（x-deferred 全 spec 清零含 154+152+153）
>
> **本轮特别贡献**：
> - **真 P0 跨 family 守门补丁**（COSTRA-104 R1 漏 + review-tech 36/40 漏检 · 153 R2 形式审捕获 · 152 R1 一并修补 · GET/PATCH/DELETE 三处共享守门 · 反向验证 + Human curl 实测双重铁证）
> - **§LINKAGE 联合决策双锚点全落地**：决策 1 K3（158 范式复刻）+ 决策 2 query `?version=N`
> - **Sprint-3 末 Retro 议题 #5 入档**：service 层 user/family 守门作为 review-tech C8 维度强约束（候选 D-022 v2.0 评分表升级）
>
> **Sprint-3 进度**（接 4/9 之后）：
> - **已 CLOSED 4/9 卡 · 估点 15/29 = 52%**：106(1)+103(8) Sprint-2 + 152(3)+153(2) Sprint-3 头部
> - **等 staging 重测**：154(5)+150(5) v1.2 协议升级 R1.x.2（Human 时间窗决定）
> - **顺手未启**：159(1)+161(1)+162(1)+163(1) = 4 点
> - **中后段未启**：151(5 conflict UI)+155(5 全量自动化)
>
> **下一步推荐路径**（按 ROI）：
> 1. **🟡 等 staging**：Human 时间窗启 154+150 v1.2 重测 + 联合 approve（推 Sprint-3 头部 6/9 = 83%）
> 2. **🟢 任意时间顺手批**：`start:159+162` miniapp 双卡 / `start:161+163` devops 双卡（每批 ~1~2h · 单装扮档双 commit）
> 3. **🟢 中后段卡**：`start:151` conflict UI（design+miniapp 双装扮 · 5pt · ~半天）/ `start:155` 全量自动化（qa+miniapp 双装扮 · 5pt · ~半天 · 依赖前置 4 卡 CLOSED）
>
> **本轮落档**（commit 待落 · 路径 1 全闭环编排层）：双 FINAL.md（152/153）+ backlog v0.2.20→v0.2.21（双卡 Doing→Done · terminal_verdict APPROVED）+ board 顶部条 + Sprint-3 Done 段（双卡条目）+ Sprint-3 Todo 段（双卡标 CLOSED）+ backend-dev state.md §2 closure + §7 时间戳 + HANDOFF v1.22 + 单一 closure commit
>
> （上一断点归档）2026-05-22 20:45：🚀 Sprint-3 头部双卡 152+153 R1+R1.x.1 全闭环 · D-014 同轮范式第 3 次实战完美收官 · 等 Human 联合 approve（已收官）
>
> **本对话轮成果**（5 commits 已 push origin/dev · ~3 小时高密度）：
> - `db7affa` **docs(repo)**：双卡 Card-Review R1+R2 闭环（152 R1 PASS-WITH-FOLLOWUP 25/30 → R2 PASS 28/30 · 153 R1 REVISE 22/30 → R2 PASS-WITH-FOLLOWUP 26/30 · §LINKAGE 双决策拍板：K3 + query `?version=N` · 11 项 FU 全落地）
> - `513dd5a` **feat(backend)**：COSTRA-152 R1 实装（PATCH /entries/{id} + K3 method-override · entryRepo.findById userId 重载 + entryService.findById 调用方更新 · 13 files +1035/-138）+ **附加 P0 跨 family 守门补丁**（COSTRA-104 漏 + review-tech 36/40 漏检的真 P0 · 影响 152 T7 + 153 T6 + GET /entries/{id} 三处共享守门）+ entries-patch.test.ts 9 测 + entries.test.ts T-CROSS-FAMILY GET 测 + history 68 行 + state.md
> - `ccd80b9` **feat(backend)**：COSTRA-153 R1 实装（DELETE /entries/{id} 软删 + query `?version=N` · 6 files +272/-35）+ entries-delete.test.ts 6 测 + history 49 行
> - `167bf17` **fix(backend)**：R1.x.1 双胞胎 P1 同 commit 修订（D-017 v3 §2.4 E1 极窄修复第 10+11 次实战 · OpenAPI PATCH+DELETE 双端点加 403 Forbidden 响应 · doc-only 1 行 × 2 · 决策保留 404 优先不泄露 entry 存在性 · 403 仅契约扩展空间）+ 双 round-1-tech.md 落档 + state.md
> - 本 commit（待落 · HANDOFF v1.21 + board + backlog v0.2.20 编排层落账）
>
> **关键 P0 修复事件**（同对话轮捕获 + 修复 + 反向验证铁证）：
> - **R2 卡审形式审捕获**：跨 family 越权守门盲区 · entryRepo.findById 仅 JOIN family_members 不按 userId 过滤 · entryService.findById userId 接收但未实际使用 · 任意 userId 可查 / 改 / 删任意 entry（只要 entry 的 family 至少有一个成员）
> - **R1 实装一并修补**：findById(entryId, userId?) 重载（带 userId 时 JOIN AND fm.user_id = $2 守门 · 不带时供 service 内部冲突回查）· 三处共享守门 · 不分独立卡
> - **反向验证铁证**：临时移除 fm.user_id = $2 → 3 测全 FAIL（PATCH T7 + DELETE T6 + GET T-CROSS-FAMILY）→ revert → 70/70 全绿（守门生效的确定性证明）
>
> **review-tech R1 双卡同 spawn**（D-022 v2.0 第 9+10 次实战）：
> - **152 PASS-WITH-FOLLOWUP 37/40**（C1=4 缺 OpenAPI 403 / C6=4 console.error 残留 / C7=4 / 其他 5/5 · 1 P1 + 2 P2）
> - **153 PASS-WITH-FOLLOWUP 39/40**（C1=4 缺 OpenAPI 403 / 其他 5/5 满分 · 1 P1 双胞胎 + 1 P3 观察）
> - 守门补丁特别评论：✅ 完整 + ✅ 反向验证铁证认可
> - R1.x.1 双胞胎 P1 同 commit `167bf17` 修订 → 期望升 38+40
>
> **下一步 = Human 联合 152+153 staging/curl 实测 + `approve:COSTRA-152 + COSTRA-153` 联合双卡同轮 approve**（D-024 §2.2 C1 第 4 次实战 · 与 154+150 解耦不依赖 staging）：
> - 实测路径：curl PATCH /v1/entries/{id} 带 body version + curl DELETE /v1/entries/{id}?version=N + curl GET（守门测）+ method-override POST + X-HTTP-Method-Override: PATCH
> - server 70/70 自测全绿 · curl 实测主要验集成层路径
> - approve 后 Sprint-3 头部累计 4/9 卡 CLOSED · 估点累计 15/29 = 52%
>
> **本轮范式累计**：D-014 同轮范式第 3 次实战完美收官（105+156 / 154+150 / **152+153**）· D-016 100% 修订率连续第 7~8 张（累计 105+156+158+154+150+152+153）· D-017 v3 §2.4 E1 极窄修复第 10+11 次实战 · D-018 SBAI v1.1 第 N 次冒烟（card-reviewer-tech 双卡同 spawn × 2 + backend-dev 双卡联合 spawn + review-tech 双卡同 spawn）· D-022 v2.0 评分表第 9+10 次实战（37/40+39/40）· D-024 §2.2 C1 攒批第 4 次候选 · D-025 AP-003 第 4+5 次正向兑现 · D-018 §3.5 越权例外路径多次实战
>
> **本轮新范式 / 议题**（议入 Sprint-3 末 Retro）：
> - **R2 形式审 = 第 N 道闸**：本轮 153 R2 形式审捕获 P0 跨 family 守门盲区（COSTRA-104 R1 实装 + review-tech 36/40 双重漏检）· 暴露盲区：路由参数 userId 接收但未实际使用是常见 review 漏检模式 · 候选 D-022 v2.0 评分表 C8 增项 "service 层接收 userId 必须有实际使用证据"（已记 backend-dev state.md §6 议题 #5）
> - **404 vs 403 跨 family 语义判定**：保留 404（不泄露 entry 存在性）+ OpenAPI 加 403（契约扩展空间）· 安全优先决策范式
>
> （上一断点归档）2026-05-22 17:45：🐛🚀 **Sprint-3 头部双卡 R1.x.2 v1.2 协议升级闭环**（154+150 联合实测发现 P0+P1 双 BUG → 选项 B 同轮彻底升级 ISO→BIGINT change_seq · 3 笔原子 commit · 等再次 staging 实测）
>
> **R1.x.2 v1.2 协议升级 完整闭环**（单一对话轮 · 联合实测捕获 → BUG 立卡 → 选项 B 同轮彻底修复 · 范式新增）：
> - **联合 staging 实测**（v1.2 升级前）：Human 实测 5 条断言 A~E 期间发现 **2 个 BUG**：
>   - **COSTRA-150-D**（P0）：outbox 死锁——sync.ts catch 静默吞错 + drainBatch recover 仅捞 retries>0 + ackResults 字段错配（idempotency_key vs ack_batch_key）→ push 失败后 drained 永久残留
>   - **COSTRA-154**（P1）：watermark 精度截断——JS Date 毫秒 vs PG TIMESTAMPTZ 微秒（实测 137μs 差） → 同条 entry 永久重传
> - **Human 决策选项 B**（同轮彻底修复 · 不背历史包袱）：watermark 协议从 ISO 时间戳 → **BIGINT change_seq**（自增序列号承担一致性 · updated_at 保留语义）
> - **R1.x.2 实装**（3 笔原子 commit · 已 push origin/dev）：
>   - `31fb893` **fix(backend)**：migration 0006（CREATE SEQUENCE entries_change_seq + ALTER ADD change_seq + 历史回填 + UNIQUE）+ entryRepo（insert/update/softDelete 显式 nextval · findEntriesByFamilySince since:bigint order by change_seq）+ syncPullService（watermark = last row change_seq number · entryToWire emits change_seq）+ pullQuerySchema since:integer minimum=0 + test/setup pg-mem 注册 setval mock + sync-pull.test +T18/T19/T20（update 推进 / 同事务多 INSERT / 软删推进）+ openapi watermark integer int64 · Entry.change_seq 新增 · **server 56/56 PASS**
>   - `2b28210` **fix(miniapp)**：v1.2 watermark 适配（db.ts getWatermark 返 number · legacy ISO 自动重置为 0 · setWatermark 防御负数/浮点 · sync.ts/syncScheduler.ts watermark:number · db.spec +4 v1.2 回归测 · syncScheduler.spec 5 处 mock + 1 处断言升级）+ **outbox 死锁修复 150-D**（sync.ts 不再吞错 · outbox.ts 加 ackBatchFailure + drainBatch 防御性 recover + 修复 ack_batch_key 字段）· **client 58/58 PASS**
>   - `261c280` **docs(qa)**：sync-protocol.md §6.3 v1.2 完全重写 + 2 张 BUG 卡（150-D 死锁 P0 · 154 watermark 精度 P1 · 154 §11 v1.2 升级声明 693 行）+ joint-smoke v1.3 §3.E 期望数字 watermark + .gitignore 加 .steve/
> - **协议演化**：v1.0 ISO ms → v1.1 ISO μs（中途未上线）→ **v1.2 BIGINT change_seq**（当前生效 · 破坏性升级 · client legacy ISO watermark 自动重置）
>
> **本轮新建立的范式 / 议题**（待 Sprint-3 末 Retro 议入）：
> - **范式新增**：D-024 §2.2 C1 联合实测**首次触发 R1.x.2 协议破坏性升级**——以往 R1.x.1 都是 review-tech P1/P2 修订型，本轮证明"联合实测 = 真闭环最后一道闸"立意（vs 单测 + curl 都漏不出 outbox 死锁 + watermark 精度）
> - **议题新增**：(1) 协议演化版本号变更条件（什么级别的 BUG 触发协议 v1.x → v2.x · 区别 doc-only sync 与破坏性 schema 升级）；(2) 微秒精度 vs 自增序列号在分布式时序上的取舍范式；(3) pg-mem 测试基础设施补强（setval/timezone/to_char mock 沉淀为公共 helper）
>
> **下一步 = Human staging 重启 + 再次联合实测**（暂缓今日不做）：
> - server staging 重启跑 migration 0006（PG SEQUENCE + ALTER + 回填）
> - 重跑联合 smoke 5 条断言 A~E（断言 D/E 重点验证 v1.2 watermark BIGINT + outbox 死锁修复）
> - `approve:COSTRA-154 + COSTRA-150` 联合双卡同轮 approve 收 Sprint-3 头部 2/9
>
> **本轮落档**：3 笔原子 commit（`31fb893` + `2b28210` + `261c280`）· server 8 文件 + client 8 文件 + qa/docs 6 文件 = 22 文件 · ~2100 行净增 · 全测试绿（server 56/56 + client 58/58 + typecheck + eslint）· **15 commits 已 push origin/dev** + HANDOFF v1.19 锚点 commit `7c52b82`（已 push · 16 commits）+ **路径 A 编排层落账 commit `3b3aa9a`**（backlog v0.2.18 加 2 张 BUG 卡 150-D/154-D + 154/150 升级 In-R1.x.2 · backend-dev/miniapp-dev state.md §2/§3/§6/§7 升级 + 各 1 份 R1.x.2 history · follow-ups README 速查表 28 条 + 4 张新 Sprint-3 末 Retro 议题登记 + FU-104/FU-103 状态从 closed 降为 R1.x.2-fixed-pending-verify · FU 不真 closed 直至 Human approve 铁律守护）
>
> （上一断点归档）2026-05-20 13:25：🚀🚀 **Sprint-3 头部双卡 R1 全闭环 · COSTRA-154 + COSTRA-150 双卡 review-tech APPROVE 等 Human 联合 staging 实测**（D-024 §2.2 C1 第 3 次实战候选 · 105+156 / 157+158 / **154+150** 三连）
>
> **COSTRA-150 R1 完整闭环**（单一对话轮 · D-014 同轮范式 · 154 范式复刻）：
> - 卡审 R1：verdict=REVISE 21/30（3 P0 + 2 P1 + 2 P2）· P0-1 dispatch 引用 5 处不存在 API（outbox.flushPending / auth.getValidToken / family.ts / request.get 链式 / db.getWatermark 类型）· P0-2 缺 G15 · P0-3 entry 非 tabBar 页
> - dispatch 修订 5 处：A 项改用 sync.ts 封装的 pushDelta+syncPull（一次解决 5 处不一致中的 4 处）+ G15 + entry 排除 + §3.5 runtime 实测断言 5 条 + commit footer 大写
> - 卡审 R2：verdict=APPROVE 29/30（形式审 · D-016 同轮第 18 次实战）
> - R1 实装 commit `ee97a7a`（amend 链 535c1f9 → 4751491 → ee97a7a · miniapp-dev 单装扮档 · 7 项 scope 全交付 · 52/52 测全绿 · syncScheduler.ts 158 行 + spec 226 行 · 复用 sync.ts pushDelta+syncPull 范式 · 不重写 sync 逻辑）
> - R1 Review：verdict=PASS-WITH-FOLLOWUP 34/40（0 P0 / 2 P1 / 3 P2 · D-022 v2.0 第 8 次实战 · D-025 三项全 PASS）· P1-1 hash amend pattern（与 154 R1.x.1 P1-2 同款）· P1-2 startScheduler 500ms 隐性假设缺 [未经验测] 标注
> - R1.x.1 修订 commit `5ac8153`（D-017 v3 §2.4 E1 第 9 次实战 · 6 文件 + 457 行）· P1-1 hash 4751491→ee97a7a 5 处 + P1-2 [未经验测] 注释 14 行
> - **R1.x.1 修订后**：verdict 升级 APPROVE 38/40 · 等 Human 联合 154 staging 实测 + approve
>
> **双卡范式累计**（154 + 150 双卡 R1 全闭环）：
> - **D-014 同轮范式**：连续 2 张卡 R1→R2 revise → R1 实装 → R1 Review → R1.x.1 全在单一对话轮
> - **D-016 反例预防**：第 9 次（154）+ 第 10 次（150）连续合规 · 反例已成历史
> - **D-017 v3 §2.4 E1 第 8+9 次实战**：双卡均为 PASS-WITH-FOLLOWUP 路径下 follow-up 强制 R1 一并修订 · 100% 修订率范式连续 5 卡（105+156+158+154+150）
> - **D-022 v2.0 第 7+8 次实战**：双卡同分 38/40 稳定（103 38 → 104 36 → 105 40 → 156 40 → 157 38 → 158 38 → 154 38 → 150 38 · 满分趋势回归 38 常态 · qa-planner+backend-dev+miniapp-dev 装扮档评分稳定）
> - **D-025 反模式扫描**：154 第 1 次（AP-003 正向兑现 3rd play）+ 150 第 2 次（3 项全 PASS · 复用范式不引入新漂移）
> - **hash amend pattern 复发**：154 R1.x.1 P1-2 + 150 R1 P1-1 同款 · 留 Sprint-3 末 Retro 议题（候选 @SELF_COMMIT_HASH@ 占位符 + CI hook 回填）
>
> **下一步 = D-024 §2.2 C1 第 3 次实战联合 approve**：
> - Human 联合 154+150 staging 实测（5 条 §3.5 断言 A~E · 含 launch / page-show / network-recover / watermark 持久化 / Console 无 error）
> - `approve:COSTRA-154 + COSTRA-150` 联合双卡同轮 approve（105+156 范式 / 157+158 范式 第 3 次复用）
> - Sprint-3 头部 2/9 卡 CLOSED · 累计 10/29 估点 = 34%
>
> **本轮落档**（commit `5ac8153`）：6 文件 · 含 syncScheduler [未经验测] 注释 + 5 处 hash 回填 + Card-Review R1+R2 + Review R1 三份报告
>
> （上一断点归档）2026-05-19 20:50：🚀 **Sprint-3 启动 · COSTRA-154 R1 实装完成 + R1.x.1 修订 + Sprint-3 8 张 follow-up 转正立卡 dispatch 落档**（commit `7e87bad` + `8eecd4c` + `7160724`）
>
> （上一断点归档）2026-05-19 19:53：🎉 **Sprint-2 真闭环 7/7 达成**

---
>
> **COSTRA-154 R1 完成进度**（卡审 R1+R2 + R1 实装 + R1 Review + R1.x.1 同轮全闭环 · 单一会话）：
> - **卡审 R1**：verdict=REVISE 21/30（2 P0 + 2 P1 + 2 P2）· P0-1 entries 表无 family_id 列 SQL 错误 · P0-2 缺 D-016 G15 反例预防 M 项
> - **dispatch 修订 4 处**（同 subagent 形式）：A 项 SQL JOIN ledgers + B 项 PullEntryRow 类型 + G7 拆 G7a/b + 加 G15 + commit footer 大写
> - **卡审 R2**：verdict=APPROVE 29/30（修订后 · 形式审通过）
> - **R1 实装**：commit `7e87bad`（backend-dev 单装扮档 · 9 项 scope 全交付 · 14 闸门 + 3 反向验证全绿 · 49 测全绿 · entryRepo.findEntriesByFamilySince + syncPullService + routes 真实装 + OpenAPI x-deferred 删 + sync-pull.test.ts 14 测 + FU-104-SYNC-PULL closed + 105 D2 defect resolved）
> - **R1 Review**：verdict=PASS-WITH-FOLLOWUP 36/40（0 P0 / 2 P1 / 3 P2 · D-022 v2.0 第 7 次实战）· D-025 AP-003 命中并修复（正向兑现 3rd play）
> - **R1.x.1 修订**：commit `8eecd4c`（D-017 v3 §2.4 E1 第 8 次实战）· P1-1 SyncPullResult.changes ledgers 类型 never[] → unknown[] + P1-2 5 处文档 commit hash 引用统一 00d604c → 7e87bad
> - **R1.x.1 修订后**：verdict 升级 APPROVE 38/40 · 等 Human 联合 150 实测 + approve（D-024 §2.2 C1 攒批）
>
> **Sprint-3 8 张 follow-up 转正立卡 dispatch 同轮落档**（一次性预案 · 不主动 spawn · 等 Human 按节奏触发）：
> - **COSTRA-150** · client sync 调度器（P1 5pt miniapp-dev · 严格依赖 154 R1 APPROVE · 联合 approve 优选）
> - **COSTRA-152** · PATCH /entries/{id} 实装（P1 3pt backend-dev · entryService.updateWithVersion 已全备 · K3/K1 决策点）
> - **COSTRA-153** · DELETE /entries/{id} 软删（P1 2pt backend-dev · entryService.softDelete 已全备 · version 传递方式决策点）
> - **COSTRA-151** · conflict 合并 UI（P2 5pt miniapp-dev+design-maker · Sprint-3 中后段 · 154+150 CLOSED 后启）
> - **COSTRA-155** · 全量 15 用例自动化 + CI（P2 5pt qa-planner+miniapp-dev · 154+150+152+153 全 CLOSED 后启 · 双装扮档）
> - **COSTRA-159** · outbox.spec.ts fake timers 重构（P2 1pt miniapp-dev · 与 150 顺手）
> - **COSTRA-161** · whitelist-check 规则 E（P2 1pt devops-ops · D-025 AP-003 自动检测 · CI 对账族第 6 张）
> - **COSTRA-162** · dev mockLogin runtime toggle（P3 1pt miniapp-dev · 30min 顺手）
> - **COSTRA-163** · whitelist-check ICP 强等值校验（P2 1pt devops-ops · 与 161 同节奏批）
>
> **Sprint-3 估点**：154（5）+ 24 = **29 点 + 3~7 紧急卡 buffer = 30~36 点目标**（D-019 §3.2 范式 · 与 Sprint-2 32~36 同区间）
>
> **Sprint-3 启动序列推荐**（D-024 §2.2 攒批节奏）：
> 1. **154 + 150 联合**（C1 路径第 3 次实战 · 等 Human 触发 `start:COSTRA-150` 启 150 链路 → 联合 approve）
> 2. **152 + 153 联合**（C1 路径第 4 次实战 · K3/K1 决策点 + version 传递决策点）
> 3. **155 全量自动化**（中段 · runtime 实测前置工程支撑）
> 4. **151 conflict UI**（中后段 · 双签 review · UI 测试）
> 5. **159 + 162 + 161 + 163 顺手批**（小卡攒批 · 末段清扫）
>
> **本轮落档**：
> - 9 文件 · commit `8eecd4c`（含 dispatch 修订 + R1.x.1 fix + 3 reviews + state.md/history + 5 处 hash 引用）
> - 9 张 dispatch（154 已修订 + 8 张新立）
> - follow-ups README 同步 8 张转正状态
> - backlog.json v0.2.16 + board.md 顶部条 + Doing 列加 154 + Sprint-3 todo 表
> - HANDOFF v1.17（本次更新）
>
> **下一步 = Human 触发任意一条 Sprint-3 启动指令**：
> - `start:COSTRA-150` ← 推荐 · 启 150 链路（D-014 同轮范式 · ~3~4h 自驱 · 等 Human 联合 154 实测 + approve）
> - `start:COSTRA-152` 或 `start:152+153` ← 152/153 联合启动
> - `start:COSTRA-159` 或 `start:COSTRA-162` ← 顺手小卡
> - `push` ← 仅推送（origin/dev 落后 3 commit · 含 Sprint-2 closure + Sprint-3 启动批量产出）
>
> （上一断点归档）2026-05-19 19:53：🎉 **Sprint-2 真闭环 7/7 达成**（COSTRA-157+158 双卡 Human T1 APPROVED CLOSED · 联合实测 16/16 全 PASS · D-024 §2.2 C1+C4 第 2 次实战 · D-025 AP-001 第 1 次正向规避铁证）
>
> （上一断点归档）2026-05-19 09:27：🏆🏆 **COSTRA-156 + COSTRA-105 双卡 Human T1 APPROVED CLOSED · Sprint-2 主线 4/7+5/7 双卡同轮收官**

---

## §1 当前节点与待办（**每次会话结束前必须刷新**）

### §1.1 当前时间戳

- **更新时间**：2026-05-23 21:10
- **更新者**：Orchestrator（路径 α Phase-1 prod-bootstrap v1.0→v1.1 修订 · Human 反馈 OS 是 tlinux3.3 + PG/Redis 改本地原生 · 待落 v1.1 修订 commit · 累计 27 commits push origin/dev · 本轮加 1 编排层 commit = 28）
- **Sprint**：✅ **Sprint-1 收官** / ✅ **Sprint-2 真闭环 7/7** / 🚀 **Sprint-3 头部 4/9 卡 CLOSED + 路径 α prod 验收启动**（D-026 接受 staging↔prod 合并 Sprint-3~Sprint-5 期 · 估点 15/29 = 52% · 等 154+150 prod 闭环推 6/9 = 83%）

### §1.2 当前在办卡

| 卡号 | Owner | 阶段 | 下一步 |
|---|---|---|---|
| **COSTRA-152** | backend-dev | ✅ **CLOSED @ 2026-05-23 16:15**（APPROVE 37/40 → R1.x.1 后 ≥38 · `.team/reviews/COSTRA-152/FINAL.md`）| — |
| **COSTRA-153** | backend-dev | ✅ **CLOSED @ 2026-05-23 16:15**（APPROVE 39/40 → R1.x.1 后 ≥40 · `.team/reviews/COSTRA-153/FINAL.md`）| — |
| **COSTRA-154** | backend-dev | **R1.x.2 v1.2 协议升级完成 @ 2026-05-22 17:30 · APPROVE 38/40**（commit `31fb893` + `261c280`）| 等 Human staging migration 0006 + 再次联合 154+150 实测 → `approve:COSTRA-154 + COSTRA-150`（D-024 §2.2 C1 第 3 次实战 · 暂缓 Human 时间窗）|
| **COSTRA-150** | miniapp-dev | **R1.x.2 完成 @ 2026-05-22 17:30 · APPROVE 38/40**（commit `2b28210`）| 同上 |
| **COSTRA-151** | miniapp-dev+design-maker | dispatch-ready @ 2026-05-19 20:50 | Sprint-3 中后段 · 154+150 CLOSED 后启（5pt UI · ~半天）|
| **COSTRA-155** | qa-planner+miniapp-dev | dispatch-ready @ 2026-05-19 20:50 | Sprint-3 中后段 · 全部头部 CLOSED 后启（5pt 自动化 · ~半天）|
| **COSTRA-159** | miniapp-dev | dispatch-ready · 顺手小卡 | 任意时间（与 150 同链路 · 1pt · ~30~60 分钟）|
| **COSTRA-161** | devops-ops | dispatch-ready · 顺手小卡 | 154 CLOSED 后启 · 与 163 同节奏批 |
| **COSTRA-162** | miniapp-dev | dispatch-ready · 顺手小卡 | 任意时间 · 30 min 单 commit |
| **COSTRA-163** | devops-ops | dispatch-ready · 顺手小卡 | 与 161 同节奏批 |
| **COSTRA-114** | DevOps-Agent | 卡定义已 approve · 实际未开工（Sprint-1 残留）| 等 Human `run devops COSTRA-114` |
| **COSTRA-160** | Design+MiniApp | Backlog | 等 Human 触发 |

### §1.3 Human 下一步动作（**预期 · 按优先级 · 路径 α 已启动**）

1. **🟡 立即可做（单一对话回复）**：在对话中回 "OK 接受 D-026 §2.3" 或 "确认 D-026 工程纪律 4 条" → Orchestrator 进 Phase-1 等你 SSH
2. **🟡 接续做（Phase-1 prod-bootstrap · 60~90 min Human 操作）**：
   - SSH 49.235.216.20 跑 `infra/prod-bootstrap.md` §1~§8
   - 拍板点 3 个：§2.1 仓库 URL（P1 git clone / P2 rsync）· §3.1 Postgres 强密码（openssl 生成）· §4.2 WX_APP_SECRET（微信公众平台扫码取） + §7.3 Let's Encrypt 邮箱
   - Phase-2 闸门 5 条全 PASS（healthz / icp / 401 守门 / systemd / **C2 mock grep**）后回贴 PASS/FAIL 表
3. **🟢 Phase-3 等 Phase-2 PASS 后由 Orchestrator 派 qa-planner**：改造 `qa/costra-154-150-joint-smoke.md` v1.3→v1.4 prod 版（去 mock + 真 wx.login + 切 prod URL）→ Human 跑 5 条断言 A~E
4. **🟢 Phase-4 等 Phase-3 PASS 后**：派 qa-planner 改 `docs/qa/costra-152-153-curl-verify.md` v1.0→v1.1 prod 版 → Human 跑 H1~H5 真 prod 回归
5. **🟢 Phase-5 双 Phase 全 PASS**：联合 `approve:COSTRA-154 + COSTRA-150` → Sprint-3 头部 6/9 = 83%
6. **🟠 时间窗口**：R-019 公安联网备案 🟡 已提交（2026-05-19）等公安系统 15~20 工作日审核（预计 2026-06-09 ± 5 天）· 不阻塞任何节点
7. **🟢 被动等**：订阅消息文案 v0.1（Sprint-5 触发）/ 隐私指引法务审核（Sprint-7 触发）

#### 🔥 路径 α 启动建立的范式（新对话 Orchestrator 必知）

- **D-026 §2.3 4 条工程纪律是 Sprint-3~Sprint-5 期硬约束**：C1~C4 任一违反 → R-020 升 🟠 强制重启 D-023 §2.4 (a) 子域 · 阻塞 Sprint-3 后续推进
- **C2 mock 防护最严**（关联 R-008 极高 🔴）：systemd EnvironmentFile WX_MOCK_LOGIN=0 显式声明 + 启动日志 grep 验证 + CI 静态扫描三层防御
- **C3 DB 操作三件套**（dump→operate→verify）任何 prod schema 改动需 Human 拍板 · D-009 §2.4 安全基线在 staging↔prod 合并语境下的具体化
- **D-026 §2.4 αβγδ 重启硬触发**：α 灰度 / β 数据量 > 10万 entries / γ Sprint-6 公测前 / δ 安全事件 · 任一触发立 D-024+ 子域重启卡
- **SBAI v1.1 工具白名单平台限制**：subagent task spawn 时继承的是 code-explorer 只读工具集 · 装扮档无写权 · 历史先例 Orchestrator 兜底落档（D-019/D-021/D-022/D-023/D-026 ）兼容此模式 · 议入 Retro 议题 #6 候选 D-027

#### 🔥 152+153 双卡建立的范式（新对话 Orchestrator 必知）

- **D-014 同轮范式第 3 次完美收官**：单一对话轮 6 阶段全跑通（Card-Review R1+R2 → R1 实装双 commit → review-tech R1 → R1.x.1 → curl 实测手册 → Human approve）· 高密度产出 ~3 小时（昨日）+ ~30min（今日实测+approve）
- **R2 卡审形式审 = P0 漏洞最后一道闸**：路由参数 userId 接收但未实际使用是 review-tech 常见漏检模式 · COSTRA-104 R1 实装 + review-tech 36/40 双重漏检 · 153 R2 卡审形式审捕获 · 议入 Retro 升 D-022 v2.0 C8 维度强约束（议题 #5）
- **守门补丁三处共享 + 反向验证铁证**：findById userId 重载 + 三处路由（GET/PATCH/DELETE）共享守门 + 临时移除→3 测全 FAIL→revert→全绿 + Human curl §7 真链路再次确认
- **R1.x.1 双胞胎 P1 同 commit**：双卡 OpenAPI 同款 P1 → 同 commit 修订（1 行 × 2）· D-017 v3 §2.4 E1 极窄修复范式
- **404 vs 403 跨 family 语义**：保留 404（不泄露 entry 存在性 = 安全优先）+ OpenAPI 加 403（契约扩展空间）· 双重保险

### §1.4 Sprint-1 治理范式资产（5 卡簇定稿 · v5）

**FU-LAUNCH 族 4 次定性翻转**（重要事故学习记录）：

| 版本 | 定性 | 卡号 | 状态 |
|---|---|---|---|
| v1~v2 | 误判 · 见 history | 124 | 已修正 |
| v3 | SDK + 业务共责（onLaunch 同步 storage） | 125 | 被 v4 证伪 |
| v4 | SDK race · 业务无责 | 126 | 被 v5 证伪 |
| **v5（定稿）** | 双因（SDK race · lib 3.8+ 修复 + 业务 onShow setData 时序竞速 · COSTRA-127 修复） | **127** | **唯一定稿** |

**v5 定稿存于**：`docs/devops/libversion-upgrade.md §3.4`

---

## §2 必读清单（新 Orchestrator 接续时按优先级 Read）

> **约定**：下表从上到下优先级递减 · 首 6 份是**必读** · 剩余是**按需读**（遇到具体问题再查）。

### §2.1 必读（**每次新会话启动都读**）

1. **`.team/HANDOFF.md`** — 本文件 · 锚点入口
2. **`.team/board.md`** — 最后更新行 + Sprint-1 Done 段（14 卡终审记录）
3. **5 张 FINAL.md**（5 卡合并终审 · 含 SOP 偏差合规说明）：
   - `.team/reviews/COSTRA-102/FINAL.md`（T1 主线 · Mock + 本地 server 实测）
   - `.team/reviews/COSTRA-125/FINAL.md`（T2 fix · 跨 lib 实测兜底）
   - `.team/reviews/COSTRA-126/FINAL.md`（T3 chore 自动关闭）
   - `.team/reviews/COSTRA-127/FINAL.md`（**T2 fix · review-tech R1 跳过 · Human 终审吸收 R1 职责** · 议题 17 实战二次兑现）
   - `.team/reviews/COSTRA-128/FINAL.md`（T3 chore · 删比加多 -57/+17）
4. **`docs/devops/libversion-upgrade.md`** — v5 定稿（COSTRA-128 清洗后唯一定稿 · §3.4 + §3.5 反模式 #5 + §3.6 反模式 #6 + §4 跨 lib 对照表）
5. **`.team/follow-ups/README.md`** — Sprint-2 转移 FU 队列（FU-DB-OPS-AUDIT 首位 + FU-LIBVERSION-DEV-GUARD + FU-102-* 5 条 + 旧 FU-118-* 等）
6. **`.team/members/miniapp-dev/state.md`** — 装扮 subagent 当前状态（active tasks 已清空 · §6 已大幅清洗）

### §2.2 按需（**遇到对应场景才读**）

| 场景 | 文件 |
|---|---|
| 理解 SBAI 框架 | `.team/decisions/D-018-spawn-based-agent-isolation.md` v1.1 |
| 理解验证问题 SOP | `.team/decisions/D-017-verification-problem-response-sop.md` |
| 理解 Review 流程 | `.team/SOP-REVIEW.md` §3/§4/§5 · `.team/SOP-CARD-REVIEW.md` |
| 理解 Human 触发铁律 | `.team/SOP-HUMAN-TRIGGER.md` |
| 理解 revise/response 格式 | `.team/decisions/D-015-unify-respond-revise.md` |
| 看本次 COSTRA-124 根因报告 | `.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md`（183 行 · L1-L4 四层根因） |
| 看本次 R1 实装报告 | `.team/members/miniapp-dev/history/2026-05-02-costra-124-r1-implement.md`（122 行 · 5 段模板） |
| Q12 踩坑记录（Subagent frontmatter）| `.team/members/README.md §7` |
| 金额红线 | `.team/decisions/ADR-0002.md` · 本卡不涉金额 |
| 主体红线 | `.team/decisions/D-008.md` · 本卡已合规 |

---

## §3 SBAI v1.1 框架速查（新会话直接可用）

### §3.1 10 个 subagent 已注册（`.codebuddy/agents/costra-*.md`）

| 类型 | Subagent 列表 | 工具白名单 | permissionMode |
|---|---|---|---|
| **装扮档**（6 个） | `costra-miniapp-dev` · `costra-backend-dev` · `costra-pm-writer` · `costra-design-maker` · `costra-devops-ops` · `costra-qa-planner` | `Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite, WebFetch` | **`bypassPermissions`**（2026-05-08 改造 · 见 commit `4399ee9`）|
| **审查档**（4 个） | `costra-review-tech` · `costra-review-product` · `costra-card-reviewer-tech` · `costra-card-reviewer-product` | `Read, Grep, Glob, LS, Bash, WebFetch`（**物理无文件写权 · Bash 仅只读语义**）| **`bypassPermissions`** |

> **2026-05-08 改造**：原 `acceptEdits` / `default` 全部改为 `bypassPermissions` · 4 个 reviewer 加 `Bash`（仅只读纪律）· 全员追加破坏性命令禁令段（push --force / reset --hard / rm -rf 项目根 / npm publish 等）· devops-ops 加生产高危 Human 显式拍板红线（terraform apply / kubectl apply / miniprogram-ci upload）。
>
> **冒烟记录**：本 Sprint-1 累计 5 次实战（miniapp-dev × 5 · card-reviewer-tech × 1 · 详见各卡 history）。审查档物理隔离稳定成立。

### §3.2 Spawn 模板（Context Injection Contract §A~§H · D-018 §3.3）

新会话 spawn 时必含：
- §A 角色规则（inline `.team/agents/0x-*.md` 全文）
- §B 公共契约（COMMON-CONTRACT §0/§0-Bis/§4/§8ter）
- §C 卡主 state.md（审查角色可略）
- §D 最近 history（1-3 份相关）
- §E 项目全景（Sprint 状态 + 最近 commit + 相关决策）
- §F 本次任务（卡号 + DoD + Round-N 要求 + diff inline）
- §G 强制阅读清单
- §H 硬约束

> **Q12 踩坑纪律**：`tools` 字段必须 **逗号分隔字符串** · 不可用 JSON 数组（CodeBuddy 解析失败）· 详见 `.team/members/README.md §7`。

---

## §4 规约铁律速查（必须遵守 · 新会话不可违反）

| 铁律 | 来源 | 核心 |
|---|---|---|
| **Human 唯一触发** | SOP-HUMAN-TRIGGER · D-018 §7 | 跨轮任何动作需 Human 显式触发 · 例外：Review 闭环内 Revise↔Review 同对话轮连续 spawn（D-011 豁免）|
| **事实源三证** | D-017 v1 | 修代码前 `git ls-files` + `git log` + `git show HEAD:` 三证齐全 · 禁止凭"记忆"改 |
| **绕 hooks 禁令** | I-011 | 禁止 `--no-verify` · 禁止 `git push --force` |
| **单卡即提交** | D-012 | 每张卡独立 commit · 允许按 scope 拆 2 个以上 |
| **Subject 全小写** | commitlint | commit subject 首字母 + 卡号全部小写（`COSTRA-124` 放 footer `Refs:` 可大写）|
| **审查档无写权** | D-018 §3.5 + COMMON-CONTRACT §0-Bis | 审查 subagent `tools` 物理白名单排除 Write/Edit/Bash · 仅 final message 返回 |
| **FU 预闭合不真 close** | 本会话 COSTRA-124 范式 | Human 实测未通过前 FU status 保持 `open` · 仅追写 f.1/f.2 段 |
| **金额/主体红线** | ADR-0002 · D-008 | 金额必经 `decimal.js` · 主体字样不进 `miniprogram/.ts/.wxml/.wxss/.json` 打包源码 |

---

## §5 本会话 commits 溯源（2026-05-04 ~ 2026-05-12 · 53 commits 已 push origin · 本轮 COSTRA-104 终审待 commit）

```
（待落盘）docs(repo): costra-104 human t1 approved closed (sprint-2 主线第 3 张收官)
5279343 feat(devops): 3 dev scripts (migrate / reset-data / seed-curl-test)  ← 当前 HEAD（已 push）
a575a4a fix(backend): post /entries pass client_ref_id (COSTRA-104 R1.x.3)
9845d82 docs(qa): costra-104 curl-verify v1.4 (db migrations all-run guidance)
929942f fix(db): add entries.account_id + to_account_id columns (COSTRA-104 R1.x.2)
b4544d5 docs(qa): costra-104 curl-verify v1.3 (psql seed step b.5)
6b242e4 fix(backend): wx mock dynamic import → static import (COSTRA-104)
454cb82 chore(repo): backend-dev state/history closure r1.x.1 (COSTRA-104)
95e00c6 feat(backend): dev wx_mock_login env switch for curl verify (COSTRA-104 R1.x.1)
db1f1fc docs(qa): costra-104 curl-verify v1.1 (port 3000→8080 + pino log)
3ba84d8 chore(repo): costra-104 round-1-tech review report (approve 36/40)
54cd931 chore(repo): backend-dev state/history closure for costra-104 r1.x
363efa1 fix(backend): t2 update conflict test + followup_id naming (COSTRA-104 R1.x)
212f181 chore(repo): costra-104 dispatch + card-review + curl-verify + 3 follow-ups
6c17085 chore(repo): backend-dev state/history closure for costra-104 r1
6d395bd feat(backend): sync/push + entries crud + 3 stub routes (COSTRA-104 R1)
dcff883 docs(repo): costra-103 human t1 approved closed (sprint-2 主线主头收官)
f125f05 docs(qa): costra-103 human-verify v1.1 + 2 follow-ups (scope gap)
3a8623b chore(repo): costra-103 round-1-tech review report (approve 38/40)
561e884 chore(repo): costra-103 backlog title sync (p1-1) + d-017 step2 diagnosis
c8b6c06 chore(repo): miniapp-dev state/history closure for costra-103 r1 (COSTRA-103)
6c0b404 fix(miniapp): outbox conflict off-by-1 + handleRetry dead code cleanup (COSTRA-103 R1.3)
acfcf0a docs(qa): costra-103 human verify manual + dispatch p1-1 fix + state/history (COSTRA-103)
1e723c7 (重复 docs commit · 实为 R1.2 收尾 · diff 不重叠)
cb3a83b feat(miniapp): db + outbox + id utils + sync.ts refactor (COSTRA-103 R1)
03422fa chore(repo): costra-106 dispatch + card-review + round-1-product reports
9fe5430 docs(docs): sprint-1 retro + d-020/d-021/d-022 decisions + metrics rewrite (COSTRA-106 R1)
d496b5d docs(repo): g4 sprint-1 closure decision + sprint-2 planning anchor (D-019)
8c93c73 docs(repo): handoff v1.3 · sprint-1 final closure (cross-session anchor)
fbac38a chore(db): extract ops audit todo to docs/db prework + ignore .cloudbase
a7a4d3a chore(repo): 5-card merged approval · sprint-1 final closure (COSTRA-102/125/126/127/128)
a77ffce docs(repo): costra-128 libversion v5 finalize + state.md cleanup (COSTRA-128)
d321b58 chore(miniapp): cleanup v3/v4 narrative comments in storage/home/mine/app (COSTRA-128)
fd7302e chore(repo): costra-127 human verify pass · fu-launch-c true closed (COSTRA-127)
737595a docs(repo): costra-127 fu-launch-c true-close + libversion v5 + anti-pattern #6
1c640f0 fix(miniapp): replace switchTab with reLaunch + onShow bootstrap gate
4399ee9 chore(repo): subagent bypassPermissions + reviewer Bash readonly
3903b9c docs(repo): costra-126 libversion-upgrade v4 + anti-pattern #5 + costra-125 close (COSTRA-126)
c52fd7f chore(miniapp): bump libversion 2.32.3 to 3.8.12 dev (COSTRA-126)
d85d040 docs(repo): costra-125 r1 fu-launch f.4 + startup-audit r2 audit
4643f89 fix(miniapp): migrate storage/auth/sync to async api + bootstrap promise (COSTRA-125)
ca27d88 docs(repo): costra-125 card-review-1-tech pass-31/35 + 4 p2 followup
6d1a6c2 docs(repo): costra-125 立卡 + costra-124 r2 诊断 + fu-launch 分裂 a/b/c
42494f1 docs(repo): add cross-session handoff anchor for orchestrator continuity
20b0e48 docs(repo): costra-124 review-tech round-1 pass-with-followup 33/35  ← v1.0 立案点
... (更早 v1.0 之前 commit 见 git log)
```

**累计**：5 卡簇治理（124~128）+ 主线终审（102）+ subagent 改造 + DB ops 搬迁 + G4 决议（D-019）+ Sprint-1 Retro 收官（COSTRA-106 + D-020/D-021/D-022）= **30 commits 已 push origin/dev**（含本轮 COSTRA-106 终审待 commit = 31）。

---

## §6 Sprint-1 末残留议题 / FU 队列（Sprint-1 末 Retro 必议）

### §6.1 重大议题

| # | 议题 | 来源 |
|---|---|---|
| 15 | "独立复核可翻转历史定性"范式明文化 → D-018 §3.5 附录 | 本会话 FU-LAUNCH 定性翻转事件 |
| 16 | SBAI v1.1 两档 tools 白名单差异化（装扮档 vs 审查档）沉淀为 D-018 §3.5 附录 | 本会话 P2'' + review-tech 双次冒烟证据 |
| 13 | Review-Tech 评分表加"runtime 加载性"维度（P0 升级）| COSTRA-123 过程复盘 |
| 10 | Sprint-0 骨架期微信规约债务**系统化主动盘点**（当前被动剥洋葱已到第 6 层）| COSTRA-119/120/121/122/123/124 同族链 |
| 11 | Review 35/35 可能基于错误假设 · "Human 实测闸"作为 runtime 规约类 T2 卡终审绝对证据 | COSTRA-121 事后证伪 |
| 12 | 同族规约盲区紧迫性（升 P0 强制）| 同上 |
| 14 | D-017 §2.3 新增 E4 例外（Human 默示/明示接受代职分析合规化）| COSTRA-123 实战 |

### §6.2 FU 队列（按优先级）

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-LAUNCH-FIRST-RENDER-RACE | **分裂为 A/B/C** · **A closed** @ COSTRA-124（commit `a296be0` · 顶层副作用分支）· **B open** · 等 COSTRA-125 修复 · **C open** · 等实测判定 | COSTRA-124 / 125 |
| FU-124-P2-1/2/3 | `open` · R1 实装时未合并（属 dispatch 元数据层） | Sprint-1 末 Retro 或 Sprint-2 |
| FU-CI-MP-BUILD-NPM-ENFORCE | `open` | Sprint-2 候选 |
| FU-REVIEW-TECH-RUNTIME-DIM | `open` · P0 议题 | Sprint-1 末 Retro |
| FU-102-SYNC-PULL-DRIFT | `open` · 高优 | Sprint-1 末 Retro 头部 |
| FU-102-HUMAN-VERIFY-PARADIGM | `open` | Sprint-1 末 SOP-REVIEW v2.1 §11 |
| FU-118-3/4/5 | `open` | Sprint-2 |
| FU-001 / FU-118-2 | `open` | Sprint-2 Epic-F 合并 |

> 完整列表见 `.team/follow-ups/README.md`（截至 2026-05-02 21:30 · 约 700 行）。

---

## §7 新 Orchestrator 接续 Checklist（**严格按此 7 步进入工作状态**）

> Human 新会话首条消息只需说："**继续 Costra · 读 `.team/HANDOFF.md` 接续**" · Orchestrator 按以下 7 步自检 · 全绿方可发第一个响应：

1. ☐ Read 本 HANDOFF.md 全文
2. ☐ Read §2.1 必读清单 6 份
3. ☐ `git log --oneline -5` 确认 HEAD 与 §5 一致（或更新后）· 若漂移 → 更新 §5 + §0
4. ☐ `git status -s` 确认工作树干净（如非干净 → 先报给 Human）
5. ☐ 对照 §1.2 Human 实测断点 · 理解 §1.4 三路径响应契约
6. ☐ 对照 §4 铁律 · 下意识不违反
7. ☐ 向 Human 发"接续完成"简短 ACK（≤ 5 行）· 明示"已读 HANDOFF + 6 份必读 + 等你实测结果/下一步指令"· **不主动跑任何工具** · 等 Human 明确触发

**接续 ACK 模板**：
```
接续完成 · HEAD 20b0e48 · 工作树 clean · 已读 HANDOFF + board + dispatch +
reviews + FU-LAUNCH + miniapp-dev state.md · 当前断点：COSTRA-124 R1 两份 Review
全绿 · 等你第 7 次模拟器实测 5 条断言结果 · 按 §1.4 三路径 α/β/γ 响应。
```

---

## §8 版本表

| 版本 | 日期 | 维护者 | 变更 |
|---|---|---|---|
| **v1.24** | **2026-05-23 21:10** | 同会话 Orchestrator | 📋 **prod-bootstrap.md v1.0→v1.1 修订**（Human 反馈 2 条调整 · 同对话轮交付 · Orchestrator 直接落档）· **变更 1**：OS 校准 Debian/Ubuntu→**tlinux3.3**（腾讯定制 RHEL/CentOS Stream 8 · dnf/yum/firewalld/SELinux/conf.d 路径）· **变更 2**：PG + Redis 部署模式 docker compose→**本地原生 systemd**（PostgreSQL 15 + Redis 7 · initdb + pg_hba SCRAM + Redis bind 127.0.0.1 + AOF + maxmemory）· **配套修订**：§0 部署架构图 / §1.1 工具补装（apt→dnf + PGDG-EL8 + EPEL + NodeSource）/ §3 整段重写（含 §3.4 强密码生成统一指引 · PG/Redis/JWT 三独立密码）/ §4.1（DATABASE_URL 用 127.0.0.1 + REDIS_URL 加密码）/ §5.1（After/Requires 改 postgresql-15+redis）/ §6.1 步骤 2 修正（DATABASE_URL→DB_URL · 跟 migrate.sh:13 实际默认值对齐）/ §7（nginx conf.d/ 路径）/ §8 闸门 4（1 svc→4 svc）/ §9 FAQ（6→8 条 · 加 Q6 Redis + Q8 SELinux/firewalld）/ §10 FU（7 条 13pt→9 条 15pt · 加 FU-PROD-PG-TUNE + FU-PROD-SCHEMA-MIGRATIONS-TABLE）/ §11 时间预估（65min→95min）· **配套刷新**：`infra/wechat/prod-readiness-checklist.md` v1.0→v1.1（闸门 4 from 1 svc 改 4 svc · 反馈格式同步）· **本轮编排层 commit 含**：prod-bootstrap.md v1.1（~700 行）+ readiness-checklist.md v1.1（~110 行）+ §13 v1.0→v1.1 变更日志（手册末尾 · 13 行变更对照表）· §0/§0-bis(v1.0 段降归档)/§1.1/§8 全刷新 · **下一步推荐 = Human 启 Phase-1 SSH 49.235.216.20 跑 prod-bootstrap v1.1 §1~§8（75~120 min · 比 v1.0 多 ~30 min · dnf 装 PG/Redis 比 docker compose pull 多步骤）+ 贴 Phase-2 闸门 5 条 PASS/FAIL** |
| **v1.23** | **2026-05-23 20:30** | 同会话 Orchestrator | 📋 **路径 α 完整版启动 · D-026 staging-prod 合并接受方案立档 + Phase-1 prod-bootstrap 手册 v1.0 落档**（同对话轮 7 文件交付 · Orchestrator 兜底落档 · subagent 装扮档工具白名单错配 incident 见 D-026 §6.1）· prod-bootstrap.md v1.0 已被 v1.24 修订替代成 v1.1 · 其余决议 / 风险登记 / SSOT 不变 |
| **v1.22** | **2026-05-23 16:20** | 同会话 Orchestrator | 🏆🏆 **COSTRA-152 + COSTRA-153 双卡 Human T1 APPROVED CLOSED · D-024 §2.2 C1 第 4 次实战完美收官**（105+156 / 157+158 / 154+150 / **152+153** 四连）· Sprint-3 头部 4/9 卡 CLOSED · 估点累计 **15/29 = 52%** · Human curl 实测 5 硬断言 H1~H5 全 PASS @ 16:15 · 26 commits 已 push origin/dev |
| v1.1 | 2026-05-03 20:32 | 本会话 Orchestrator | R1 假设 Human 第 7 次实测证伪 → R2 诊断定性翻转 v3 → Human 全按推荐 → COSTRA-125 立卡 + COSTRA-124 部分闭合 + FU-LAUNCH 分裂 A/B/C + libversion-upgrade §3 反模式 #4 追写 · §0/§1/§2.1/§6 全面刷新 |
| v1.0 | 2026-05-03 12:41 | 本会话 Orchestrator | 立案 · 随 COSTRA-124 R1 Review 末端节点 · 会话 10 commits 末端（HEAD = 20b0e48） |
| **v1.2** | **2026-05-04 08:30** | 本会话 Orchestrator | **COSTRA-125 Card-Review R1 PASS 31/35**（第 3 次 spawn 成功 · 前 2 次 Idle timeout 后 Human 选 P1 再试）· dispatch §0 补响应段 + 4 P2 记 state.md §6 · §0/§1.1/§1.2 刷新 · 下一步 spawn miniapp-dev R1 实装 |
| **v1.3** | **2026-05-08 20:16** | 本会话 Orchestrator | **Sprint-1 5 卡合并终审 APPROVED CLOSED**（102/125/126/127/128 @ 19:11）· FU-LAUNCH 族 5 卡完整收官 · v5 唯一定稿 · 26 commits 已 push · 跨会话锚点定稿 |
| **v1.4** | **2026-05-09 09:44** | 新会话 Orchestrator（接续会话）| **G4 合并闸门 PASS · Sprint-1 收官 · Sprint-2 Planning 中** · 路径 A 决议 D-019 落盘 · 议题 10~17 + 14+ 条转 COSTRA-106 Retro 卡 · 实际仅刷 §1.1/§1.2（§0/§1.3/§5/§8 v1.4 期间 silent fail · v1.5 一次性补齐）|
| **v1.5** | **2026-05-09 10:39** | 新会话 Orchestrator | 🏆 **COSTRA-106 Sprint-1 Retro 双 30/30 满分收官 · Sprint-2 第 1/7 卡 CLOSED** · `approve:COSTRA-106` Human T2 一次性裁决 · 主报告 558 行 + D-020/D-021/D-022 三决议 + metrics 工程度量定稿 + board/backlog Sprint-2 流转 · SBAI v1.1 第 6 次冒烟成功 · pm-writer 首次实战 0 漏项 · D-016 第 13~14 次实战合规 · 立卡到终审 30 分钟新纪录 · §0/§1.1/§1.2/§1.3/§5/§8 全刷新（含 v1.4 漏改补齐）· 下一步 Human 触发 `run miniapp COSTRA-103`（Sprint-2 主线主头）|
| **v1.6** | **2026-05-09 19:17** | 新会话 Orchestrator | 🏆 **COSTRA-103 Sprint-2 主线主头 38/40 APPROVE CLOSED · D-022 v2.0 评分表首次实战 + D-017 v3 完整流程首次实战** · `approve:COSTRA-103` Human T1 一次性裁决 · Sprint-2 第 2/7 卡 CLOSED · Human 模拟器实测 5 步 + 5 硬断言全 PASS · 2 条 Sprint-3 候选 FU 立件（FU-103-CLIENT-SYNC-SCHEDULER COSTRA-150 P1 + FU-103-CONFLICT-MERGE-UI COSTRA-151 P2）· 8 文件主代码 ~ 1330 行净增 · 6 闸门全绿 + 协议 100% 对齐 + 0 后端外溢 · SBAI v1.1 第 7 次冒烟 · miniapp-dev 第 6 次实战 · 审查档第 4 次实战 · D-016 第 15~17 次实战合规 · 8 commits（cb3a83b → f125f05）· §0/§1.1/§1.2/§1.3/§5 全刷新 · 下一步 Human 触发 `run backend COSTRA-104`（Sprint-2 主线第 3 张）|
| **v1.22** | **2026-05-23 16:20** | 同会话 Orchestrator | 🏆🏆 **COSTRA-152 + COSTRA-153 双卡 Human T1 APPROVED CLOSED · D-024 §2.2 C1 第 4 次实战完美收官**（105+156 / 157+158 / 154+150 / **152+153** 四连）· Sprint-3 头部 4/9 卡 CLOSED · 估点累计 **15/29 = 52%** · Human curl 实测 5 硬断言 H1~H5 全 PASS @ 16:15 · 实测手册 `docs/qa/costra-152-153-curl-verify.md` v1.0（746 行 · qa-planner 装扮档产出 commit `cfdb6e1`）· 不依赖 staging（本地 server + WX_MOCK_LOGIN=1 · 与 154+150 staging 重测路径解耦）· 联合双卡同轮 approve 一次关 2 张卡（D-014 SOP）· **152 APPROVED**：R1 commit `513dd5a` + R1.x.1 `167bf17` · review-tech 37/40 → R1.x.1 后期望 ≥38 · 含 P0 跨 family 守门补丁三处共享（GET/PATCH/DELETE）· 11 项 FU 全 closed · `.team/reviews/COSTRA-152/FINAL.md` · **153 APPROVED**：R1 commit `ccd80b9` + R1.x.1 `167bf17` · review-tech 39/40 → R1.x.1 后期望 ≥40 满分趋势 · §LINKAGE 决策 2 query `?version=N` 落地 · 8 项 FU 全 closed · `.team/reviews/COSTRA-153/FINAL.md` · **范式累计**：D-014 同轮范式第 3 次完美收官 / D-016 100% 修订率连续第 7~8 张 / D-017 v3 §2.4 E1 第 10+11 次实战 / D-022 v2.0 第 9+10 次实战（37+39 双高位）/ D-024 §2.2 C1 攒批第 4 次实战完美收官 / D-025 AP-003 第 4+5 次正向兑现（x-deferred 全 spec 清零含 154+152+153）· **真 P0 跨 family 守门补丁双重铁证**（COSTRA-104 R1 漏 + review-tech 36/40 漏检 · 153 R2 卡审形式审捕获 · 152 R1 实装一并修补 · 反向验证 3 测 FAIL→revert→全绿 + Human curl §7 真链路再次确认）· **本轮编排层 commit 含**：双 FINAL.md + backlog v0.2.20→v0.2.21（双卡 Doing→Done · terminal_verdict APPROVED + human_final_decision_at + final_report 字段）+ board 顶部条 + Sprint-3 Done 段（双卡条目）+ Sprint-3 Todo 段双卡标 CLOSED + backend-dev state.md §2 closure + §7 时间戳 · **26 commits 已 push origin/dev** · §0/§1.1/§1.2/§1.3/§8 全刷新 · **下一步推荐 = ① Human 时间窗启 staging 154+150 v1.2 重测 + 联合 approve（推 Sprint-3 头部 6/9 = 83%）② 任意时间 `start:159+162` 顺手批 / `start:161+163` devops 批 ③ Sprint-3 中后段启 151（conflict UI）+ 155（全量自动化）** · 剩余 5/9 卡共 14 点（154+150 等 staging 10 点 + 4 张顺手 4 点 + 151 5pt + 155 5pt 中后段）|
| **v1.21** | **2026-05-22 20:45** | 同会话 Orchestrator | 🚀 **Sprint-3 头部双卡 152+153 R1+R1.x.1 全闭环 · D-014 同轮范式第 3 次实战完美收官**（105+156 / 154+150 / 152+153 三连）· 单对话轮 ~3 小时高密度 · 5 commits 已 push origin/dev：① `db7affa` 双卡 Card-Review R1+R2 闭环（152 R1 PASS-WITH-FOLLOWUP 25/30 → R2 PASS 28/30 · 153 R1 REVISE 22/30 → R2 PASS-WITH-FOLLOWUP 26/30 · §LINKAGE 双决策 K3 + query `?version=N` · 11 项 FU 全落地）· ② `513dd5a` 152 R1 实装（PATCH /entries/{id} + K3 method-override · entryRepo.findById userId 重载 · 13 files +1035/-138）+ **附加 P0 跨 family 守门补丁**（COSTRA-104 R1 漏 + review-tech 36/40 漏检的真 P0 · 影响 152 T7 + 153 T6 + GET /entries/{id} 三处共享守门 · 反向验证铁证：临时移除 fm.user_id = $2 → 3 测全 FAIL → revert → 70/70 全绿）+ entries-patch.test.ts 9 测 + entries.test.ts T-CROSS-FAMILY GET 测 + history 68 行 · ③ `ccd80b9` 153 R1 实装（DELETE /entries/{id} 软删 + query `?version=N` · 6 files +272/-35）+ entries-delete.test.ts 6 测 + history 49 行 · ④ `167bf17` R1.x.1 双胞胎 P1 同 commit 修订（D-017 v3 §2.4 E1 极窄修复第 10+11 次实战 · OpenAPI PATCH+DELETE 双端点加 403 Forbidden 响应 · doc-only 1 行 × 2 · 决策保留 404 优先不泄露 entry 存在性 · 403 仅契约扩展空间）· ⑤ 本编排层 commit · **review-tech R1 双卡同 spawn**：152 PASS-WITH-FOLLOWUP 37/40（C1=4 缺 OpenAPI 403 / C6=4 console.error 残留 / C7=4 / 其他 5/5 · 1 P1 + 2 P2）+ 153 PASS-WITH-FOLLOWUP 39/40（C1=4 缺 OpenAPI 403 / 其他 5/5 满分 · 1 P1 双胞胎 + 1 P3 观察）+ 守门补丁特别评论 ✅ 完整 + ✅ 反向验证铁证认可 → R1.x.1 后期望升 38+40 · server 70/70 全绿 · **范式累计**：D-014 同轮范式第 3 次完美收官 / D-016 100% 修订率连续第 7~8 张（累计 105+156+158+154+150+152+153）/ D-017 v3 §2.4 E1 第 10+11 次实战 / D-018 SBAI v1.1 第 N 次冒烟（card-reviewer-tech 双卡同 spawn × 2 + backend-dev 双卡联合 + review-tech 双卡同 spawn）/ D-022 v2.0 第 9+10 次实战（37+39）/ D-024 §2.2 C1 攒批第 4 次候选 / D-025 AP-003 第 4+5 次正向兑现 · **本轮新议题**（议入 Sprint-3 末 Retro · 累计议题 5 项）：⑤ **service 层 user/family 守门作为 review-tech C8 维度强约束**（COSTRA-104 R1 漏 + review-tech 36/40 漏检 · 153 R2 卡审捕获 · 反映"路由参数 userId 接收但未实际使用"是常见 review 漏检模式 · 候选 D-022 v2.0 评分表升级）· **22 commits 已 push origin/dev** · §0/§1.1/§1.2/§1.2-bis/§1.3/§8 全刷新 · **下一步 = Human 联合 152+153 staging/curl 实测 + `approve:COSTRA-152 + COSTRA-153` 联合双卡同轮 approve（D-024 §2.2 C1 第 4 次实战 · 与 154+150 解耦不依赖 staging）** · Sprint-3 累计 4/9 卡（CLOSED 后） · 估点 15/29 = 52% |
| **v1.20** | **2026-05-22 18:00** | 同会话 Orchestrator | 📋 **路径 A 编排层落账完成 · backlog v0.2.18 + 双 state + 4 张 Retro 议题**（commit `3b3aa9a` · v1.19 锚点 commit `7c52b82` 之上的小版补强）· backlog v0.2.18：154/150 升级 In-R1.x.2 · 新立 2 张 BUG 卡 COSTRA-150-D（P0 outbox 死锁 · 已修 commit `2b28210` 等 staging 重测）+ COSTRA-154-D（P1 watermark 微秒精度截断 · 已 v1.2 协议升级 commit `31fb893`+`2b28210`+`261c280` 等 staging 重测）· backend-dev state.md §2/§3/§6/§7 升级 + history `2026-05-22-costra-154-r1x2-watermark-v1.2-upgrade.md`（7 段 · 含 pg-mem 兼容记录 + 闸门 G1~G8+G15 全绿 + 协议演化声明 + 4 项 Retro 候选议题）· miniapp-dev state.md §2/§3/§7 升级 + history `2026-05-22-costra-150-r1x2-outbox-deadlock-and-v1.2-watermark.md`（6 段 · 含 outbox 死锁三重根因 + Part A/B 双修复 scope + 防御性 legacy ISO 兼容代码 + 4 项 Retro 候选议题）· follow-ups README 速查表 24→28 条 · 头部追加 4 张 Sprint-3 末 Retro 新议题：① **FU-PROTOCOL-VERSION-BUMP-CRITERIA**（P1 · 协议演化版本号变更条件 v1.x→v2.x · 区别 doc-only sync 与破坏性 schema 升级）② **FU-MICROSEC-VS-AUTOSEQ-PARADIGM**（P1 · 微秒精度 vs 自增序列号在分布式时序上的取舍范式 · 候选写入 ADR-0003 时序模型选型）③ **FU-PG-MEM-SHARED-HELPER**（P2 · pg-mem 测试基础设施补强 · setval/timezone/to_char mock 沉淀公共 helper · 候选独立卡 1pt）④ **FU-JOINT-SMOKE-LAST-GATE-PARADIGM**（P1 · 联合实测 = 真闭环最后一道闸新范式 · R1.x.2 协议破坏性升级范式 vs 以往 R1.x.1 review-tech 修订型 · 候选规约 SOP-REVIEW v2.x §11 强化）· FU-104-SYNC-PULL + FU-103-CLIENT-SYNC-SCHEDULER 状态纠正：closed → R1.x.2-fixed-pending-verify（FU 不真 closed 直至 Human approve 铁律守护 · 复用 Sprint-1 末 FU-LAUNCH 4 次定性翻转积累硬约束）· **17 commits 已 push origin/dev** · 下一步 = Human staging 准备好后重启 server 跑 migration 0006 + 重跑联合 5 条断言 A~E + `approve:COSTRA-154 + COSTRA-150` 联合双卡同轮 approve（staging/prod 测试 Human 暂缓今日不做）|
| **v1.19** | **2026-05-22 17:45** | 同会话 Orchestrator | 🐛🚀 **Sprint-3 头部双卡 R1.x.2 v1.2 协议升级闭环 · 联合 staging 实测发现 P0+P1 双 BUG → 同轮彻底修复 → 等再次 staging 实测**（D-024 §2.2 C1 第 3 次实战 · **联合实测首次触发 R1.x.2 协议破坏性升级新范式**）· 联合实测 5 条断言 A~E 期间发现：**COSTRA-150-D（P0）**outbox 死锁（sync.ts catch 静默吞错 + drainBatch recover 仅捞 retries>0 + ackResults 字段错配 idempotency_key vs ack_batch_key · push 失败 drained 永久残留）+ **COSTRA-154（P1）**watermark 精度截断（JS Date 毫秒 vs PG TIMESTAMPTZ 微秒 · 实测 137μs 差 · 同条 entry 永久重传）· **Human 决策选项 B 同轮彻底修复**（不背历史包袱 · ISO 时间戳 → BIGINT change_seq · 自增序列号承担一致性 · updated_at 保留语义）· **3 笔原子 commit 已 push origin/dev**：① `31fb893` fix(backend) migration 0006 SEQUENCE entries_change_seq + entryRepo 显式 nextval + syncPullService watermark BIGINT + pg-mem setval mock + sync-pull.test +T18/T19/T20 + openapi int64 · server 56/56 PASS · ② `2b28210` fix(miniapp) v1.2 watermark 适配 db.ts/sync.ts/syncScheduler.ts + legacy ISO 自动重置 + outbox 死锁修复 sync.ts 不再吞错 + outbox.ts 加 ackBatchFailure + drainBatch 防御性 recover + 修复 ack_batch_key 字段 · client 58/58 PASS · ③ `261c280` docs(qa) sync-protocol §6.3 v1.2 完全重写 + 2 张 BUG 卡（150-D 死锁 P0 · 154 watermark 精度 P1 §11 v1.2 升级声明 693 行）+ joint-smoke v1.3 数字 watermark + .gitignore .steve/ · **协议演化**：v1.0 ISO ms → v1.1 ISO μs（中途未上线）→ v1.2 BIGINT change_seq（破坏性升级 · client legacy ISO 自动重置）· **本轮新范式**：联合实测 = 真闭环最后一道闸（单测+curl 都漏不出）· R1.x.2 协议破坏性升级范式（vs 以往 R1.x.1 review-tech 修订型）· **本轮新议题**（Sprint-3 末 Retro 议入）：① 协议演化版本号变更条件 ② 微秒精度 vs 自增序列号在分布式时序上的取舍范式 ③ pg-mem 测试基础设施补强（setval/timezone/to_char mock 沉淀公共 helper）· 22 文件 ~2100 行净增 · **15 commits 已 push origin/dev** · §0/§1.1/§1.2/§1.2-bis/§1.3/§8 全刷新 · **下一步 = Human staging 准备好后重启 server 跑 migration 0006 + 重跑联合 5 条断言 A~E + `approve:COSTRA-154 + COSTRA-150` 联合双卡同轮 approve**（staging/prod 测试 Human 暂缓今日不做）|
| **v1.18** | **2026-05-20 13:25** | 同会话 Orchestrator | 🚀🚀 **Sprint-3 头部双卡 R1 全闭环 · COSTRA-154 + COSTRA-150 双卡 review-tech APPROVE 38/40 等 Human 联合 staging 实测**（D-024 §2.2 C1 第 3 次实战候选 · 105+156 / 157+158 / 154+150 三连）· **150 R1 完整闭环单一对话轮 D-014 同轮范式 154 范式复刻**：卡审 R1 REVISE 21/30（3 P0 + 2 P1 + 2 P2 · P0-1 dispatch 引用 5 处不存在 API · P0-2 缺 G15 · P0-3 entry 非 tabBar）· dispatch 修订 5 处（A 项改用 sync.ts 封装 pushDelta+syncPull 一次解决 4/5 不一致 + G15 + entry 排除 + §3.5 runtime 5 条断言 + commit footer 大写）· 卡审 R2 APPROVE 29/30（形式审）· R1 实装 commit `ee97a7a`（amend 链 535c1f9→4751491→ee97a7a · miniapp-dev 单装扮档 · 7 项 scope · 52/52 测全绿 · syncScheduler.ts 158 行 + spec 226 行 · 复用 sync.ts 不重写）· R1 Review PASS-WITH-FOLLOWUP 34/40（0 P0 / 2 P1 / 3 P2 · D-022 v2.0 第 8 次实战 · D-025 三项全 PASS）· R1.x.1 修订 commit `5ac8153`（D-017 v3 §2.4 E1 第 9 次实战 · P1-1 hash 4751491→ee97a7a 5 处 + P1-2 startScheduler [未经验测] 14 行注释）· APPROVE 38/40 · **双卡范式累计**：D-014 同轮范式连续 2 次 / D-016 反例第 9~10 次预防成功（合规第 2~3 次连续 · 反例已成历史） / D-017 v3 §2.4 E1 第 8+9 次实战 / D-022 v2.0 第 7+8 次同分 38/40 稳定（满分趋势回归 38 常态）/ D-025 第 1~2 次套用（154 AP-003 正向兑现 + 150 三项全 PASS 复用范式不引入新漂移）/ hash amend pattern 复发（154 R1.x.1 P1-2 + 150 R1 P1-1 同款 · 留 Sprint-3 末 Retro 议题候选 @SELF_COMMIT_HASH@ 占位符 + CI hook 回填）· 下一步 = Human 联合 154+150 staging 实测（5 条 §3.5 断言 A~E）→ `approve:COSTRA-154 + COSTRA-150` 联合双卡同轮 approve · Sprint-3 头部 2/9 卡 CLOSED · 累计 10/29 估点 = 34% |
| **v1.17** | **2026-05-19 20:50** | 同会话 Orchestrator | 🚀 **Sprint-3 启动 · COSTRA-154 R1 实装完成 + R1.x.1 修订 + Sprint-3 8 张 follow-up 转正立卡 dispatch 落档** · 卡审 R1 verdict=REVISE 21/30（2 P0 + 2 P1 + 2 P2 · P0-1 entries 表无 family_id 列 SQL 错误 · P0-2 缺 D-016 G15 反例预防 M 项）· dispatch 修订 4 处（A 项 SQL JOIN ledgers + B 项 PullEntryRow 类型 + G7 拆 G7a/b + 加 G15 + commit footer 大写）· 卡审 R2 verdict=APPROVE 29/30（形式审）· R1 实装 commit `7e87bad`（backend-dev 单装扮档 · 9 项 scope 全交付 · 14 闸门 + 3 反向验证全绿 · 49 测全绿 · entryRepo.findEntriesByFamilySince + syncPullService + routes 真实装 + OpenAPI x-deferred 删 + sync-pull.test.ts 14 测 + FU-104-SYNC-PULL closed + 105 D2 defect resolved）· R1 Review verdict=PASS-WITH-FOLLOWUP 36/40（0 P0 / 2 P1 / 3 P2 · D-022 v2.0 第 7 次实战 · D-025 AP-003 命中并修复正向兑现 3rd play）· R1.x.1 修订 commit `8eecd4c`（D-017 v3 §2.4 E1 第 8 次实战 · P1-1 SyncPullResult.changes ledgers 类型 never[] → unknown[] + P1-2 5 处文档 commit hash 引用统一 00d604c → 7e87bad）· R1.x.1 修订后 verdict 升级 APPROVE 38/40 · 9 文件 + 9 张 dispatch 落档 · D-014 同轮范式 + D-016 反例第 9 次预防成功合规第 2 次连续 + D-017 v3 §2.4 E1 第 8 次 + D-022 v2.0 第 7 次 + D-025 反模式扫描清单首次套用 · **同时 8 张 follow-up 转正立卡 dispatch** · 下一步 = Human 触发 `start:COSTRA-150` 启动 150 链路 |
| **v1.16** | **2026-05-19 09:27** | 同会话 Orchestrator | 🏆🏆 **COSTRA-156 + COSTRA-105 双卡 Human T1 APPROVED CLOSED · Sprint-2 主线 4/7+5/7 双卡同轮收官**（D-014 SOP 联合双卡同轮 approve）· **156 APPROVED 40/40 满分**（D-022 v2.0 第 4 次实战连续满分 · 终审报告 `.team/reviews/COSTRA-156/FINAL.md`）+ **105 APPROVED-PARTIAL**（H1~H5 🟢 全 PASS · H6 🔴 BLOCKED-BY-COSTRA-154 自动等效回归 · v1.4 BLOCKED-BY-COSTRA-156 范式同款第 2 次实战 · 不阻 R1 · 终审报告 `.team/reviews/COSTRA-105/FINAL.md`）· **D-022 v2.0 评分表稳定趋势确立**（103 38/40 → 104 36/40 → 105 40/40 → 156 40/40 · 连续两卡满分 · qa-planner + backend-dev 双满分）· **D-022 §4.1 真兑现立意首次实测**（自动化+curl+server 单测 30+ 全绿 · Human 真链路实测 ~30min 捕获 5 发现：4 文档 gap + 1 联合 P0 BUG 双责）· 6 文件 doc-only 落盘：① + ② 双卡 FINAL.md（156: 7 §段 · 105: 8 §段 含 partial PASS 收口口径 + 5 范式建立）· ③ + ④ 双派单档 §10 终审收尾段 · ⑤ 双卡 state/history（backend-dev §2/§3/§7 + qa-planner §1.0/§2/§3/§6/§7 + 双 history/2026-05-19-*.md）· ⑥ HANDOFF v1.16 §0/§1.1/§1.2/§8 + board.md 顶部条 + Doing 列清空 + Done 列加双卡 + Todo 表 105/156 划销 + backlog v0.2.8→v0.2.9 双卡 status: Doing→Done + metrics.json _description + 双卡 terminal_verdict/human_final_decision/final_report 全刷新 · **CI 对账族第 5 张规则 D 落地**（whitelist-check.mjs · fastify prefix vs OpenAPI servers path 静态对账）· **D-016 反例第 8 次首次预防成功**（156 commit 前自检 wc -l = 0）+ **第 9 次触发+补救**（105 R1.x.1 议入 Sprint-2 末 Retro 升 P0）· Sprint-2 进度 47%→**61%**（14→**22 点** · 5/7 卡 CLOSED）· 下一步 = **COSTRA-154 转 Sprint-3 P0 头部**（FU-104-SYNC-PULL · 5 点 · 与 COSTRA-150 一同做才有意义 · 实装后回归 105 D.2+H6 自动等效闭环）|
| **v1.15** | **2026-05-18 20:4x** | 同会话 Orchestrator | ✅ **COSTRA-105 R1 Human 实测 partial PASS · 等双卡 approve 收官**（H1~H5 🟢 全 PASS · H6 🔴 BLOCKED-BY-COSTRA-154 · 方式 C ⏸️ M2 跳过）· Human 实测顺序：方式 A Mock（A/B/C PASS · H1/H2/H3/H5）→ 方式 B 本地 server（A/B/C/D.1/E PASS · H1~H5 全命中 · H4 = §5 curl idempotency_keys 缓存命中 DB count=1 · BUG-001/002 ≥ commit `9be5e84` 修复后回归无误）→ §4.2 D.2 触发 501 NOT_IMPLEMENTED（GET /sync/pull stub · OpenAPI `x-deferred: COSTRA-154` · 单测 T7 已守护）→ Human 决策方式 C 跳过 M2 复测 · 3 文件 doc-only 落盘：① `docs/qa/costra-105-human-smoke.md` v1.7→v1.8（4 处实测增量 不重构）+ ② `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`（新立 BLOCKER 缺陷单）+ ③ HANDOFF v1.14→v1.15 · commit `16fd1a0`（4 files +227/-35）|
| **v1.14** | **2026-05-18 20:1x** | 同会话 Orchestrator | ✅ **COSTRA-105 R1.x BUG 双修完成 + 手册 v1.7 精简整理**：R1.x.1（miniapp-dev BUG-001 ledger_id 字面量 · commit `33dbdea`）+ R1.x.2（backend-dev BUG-002 server payload UUID schema 校验 · commit `db488b9` 含 T9 单测）+ R1.x.1 state/history 补漏（commit `9be5e84` · D-016 反例第 9 次触发 + 补救）· 手册 v1.6→v1.7 精简 -38%（846→525 行 · Q1=C/Q2=同意/Q3=同意 推荐方案落地 · 删 §0.5.1+§0.5.3+§9 · 合并 §1~§5 模式矩阵到 §0.2 单表 + Pass/Fail 集中到 §6 + §0.7 整合到 §0.3.3 · 100% 保留 v1.6 实测核心）· §0/§1.1/§1.3/§8 全刷新 · 下一步 Human 重跑 D.1 fallback 验收（无需手动覆盖 payload.ledger_id · 验非法 UUID 返 400）→ 跑 D.2 + 全套 H1~H6 → 双卡 approve |
| **v1.13** | **2026-05-18 19:5x** | 同会话 Orchestrator | 🐛 **COSTRA-105 D.1 真链路实测兑现 D-022 §4.1 立意 · 5 个发现一次性暴露**（自动化 + curl + server 单测 30+ 全绿 · Human ~30 分钟实测捕获）：**4 个文档级 gap**（手册 v1.4/v1.5 沿用）+ **1 条联合 P0 真 BUG**（client 硬编码 `ledger_id: 'default'` + server payload schema 不校验 UUID format · PG 22P02 → 500）· 4 文件落盘：`docs/qa/costra-105-human-smoke.md` v1.5→v1.6（§4.1.1 + §4.2.2 改 wx.request fallback 5 步范式 · §4.1.2 D1.3 SQL 改 client_ref_id · D1.2/D2.2 路径降级等 FU-105-DEV-CONSOLE-HOOK 实装回归 · §4.1.4 新增"实测期发现真 BUG 处置 SOP"）+ `qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md`（**新立 P0 BUG 单 412 行 · 双责 miniapp-dev + backend-dev · 含双阶段修复方案 + 4 项 Sprint-2 末 Retro 议题**）+ `.team/follow-ups/README.md` 加族 H · QA 实测发现 3 条（BUG-105 P0 · BUG-156 P0 · FU-105-DEV-CONSOLE-HOOK P3 · 速查表 23→26 条）+ 族 I · QA 流程治理（占位 · Sprint-2 末 Retro 议题落地后填充）· §0/§1.1/§1.3/§8 全刷新 · 下一步 Orchestrator 主动派 R1.x.1（miniapp-dev ≤ 1h）+ R1.x.2（backend-dev ≤ 30min）同轮 → Human 重跑 D.1 验收 → 双卡 approve |
| **v1.12** | **2026-05-18 18:4x** | 同会话 Orchestrator | 📘 **COSTRA-105 手册 v1.5 D-023 路径升级 · prod/staging URL 收敛根域 `https://costra.cloud/v1`**（doc-only · 不影响 156/105 review-tech APPROVE 40/40 · 不需重新 review）· Human 触发"用 costra.cloud 验证正式流程"诉求 · 与 D-023 §1.3 决策动机"尽快跑通 prod 端到端验收"完全对齐 · 1 文件落盘：`docs/qa/costra-105-human-smoke.md` v1.4→v1.5（**§0.1 三模式表方式 C 行 🚧→🟢 升级** + **§0.5 新增 §0.5.0 D-023 升级路径 6 子节**：§0.5.0.1 域名收敛事实 + §0.5.0.2 阻塞条件 5/7 已解（ICP 🟢 + 主域 🟢 + R-013 🟢 + nginx/TLS 🟢 + healthz 🟢） + §0.5.0.3 推荐执行路径 3 项前置（vs v1.4 5 项 · 缩 40%） + §0.5.0.4 复跑步骤映射 + §0.5.0.5 **R-020 staging/prod 边界自检 3 项强制** + §0.5.0.6 BUG 处置 · 历史 §0.5.1~§0.5.3 D-023 §4.2 红线保留不动 · §1/§2/§3/§4/§5 步骤模式矩阵方式 C 行 5 处 URL 刷新 · §6 H4/H6 模式要求扩展 + H6 立意 v1.5 路径升级 · §7 真机矩阵 mode 列加 C-staging/C-prod · §10 修订记录 v1.5 + 外部资源依据扩展 6 条 · 立意：D-023 §1.3 缩短 prod 验收路径 · Human 操作面 7→3（57% 收敛）· 与 Sprint-2 提审前 prod 验收时间窗口对齐 · 不破坏 D-009/D-023 决策不可变性（§4.1/§4.2 双红线）· §0/§1.1/§1.3 + §8 刷新 · 下一步 Human 配白名单 → 跑方式 C 主路径 5 步 + H1~H6 + R-020 自检 3 项 → 双卡 approve |
| **v1.11** | **2026-05-13 13:5x** | 同会话 Orchestrator | 📘 **COSTRA-105 R1.2 手册 v1.4 补强 · H6 硬断言新增 + SU-004 拆 A/B + 十类覆盖**（doc-only · 不影响 156 review-tech APPROVE 40/40 · 不需重新 review）· Human 触发讨论 "curl 验证 vs 小程序连 server" 价值边界 · 经分析二者互补不重叠（curl 验 server 内核数学幂等 vs 小程序连 server 验集成层契约对齐 · COSTRA-156 修的 `/v1` URL prefix mismatch 类集成 bug · server 单测 + curl 都漏不出来 · **唯一手动捕获路径 = 小程序连 server 端到端回环**）· 4 文件落盘：`docs/qa/costra-105-human-smoke.md` v1.3→v1.4（步骤 D 拆 D.1 push 链路诊断 3 断言 + D.2 client 视角端到端回环 4 断言 · §6 H1~H5→**H1~H6** · §0.1/§0.6/§7 真机矩阵/§8 失败分流/§10 同步）+ `qa/cases/single-user-smoke.md` v1.0→v1.1（SU-004 拆 SU-004A push + SU-004B 冷启 pull 回环 · 九类→**十类含集成层契约对齐**类目 · 标题 14→15 条）+ `qa/strategy.md`（Epic-C 加 SU-004A/B + S-007 加 SU-004B + 14→15 条 + 9/9→10/10）+ `qa/automation/README.md`（14→15 条）· 立意：兑现 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律真正立意 · §0/§1.1/§1.3/§8 刷新 · 下一步 Human 跑 105 手册 v1.4 联合实测 5 步 + H1~H6（含步骤 D.2 4 条新断言）→ 双卡 `approve:COSTRA-156` + `approve:COSTRA-105` |
| **v1.10** | **2026-05-13 11:30** | 同会话 Orchestrator | 🟢🟢 **COSTRA-156 R1 完整流水落地 · review-tech APPROVE 40/40 满分 @ 11:27 · D-022 v2.0 评分表第 4 次实战连续两卡满分**（105 40/40 + 156 40/40 · 装扮档评分稳定趋势 · qa-planner + backend-dev 双满分） · 同对话轮 D-014 + D-016 + D-018 完整闭环（派单 10:35 → Card-Review 10:55 PASS 29/30 → R1 实装 11:18 commit edca8da → review-tech R1 11:27 APPROVE 40/40 · ~52 分钟全流程）· Card-Review PASS 29/30 路径下 P2-1+INFO-1+INFO-2+§4.8 修订率 100% · **D-016 反例第 8 次首次预防成功**（卡审 §4.8 DoD M 项强约束 commit 前自检 wc -l = 0）· **CI 对账族第 5 张规则 D 落地**（whitelist-check.mjs · fastify prefix vs OpenAPI servers path 静态对账）· FU-105-URL closed + 立 FU-156-OUTBOX-FLAKY（族 F · pre-existing client outbox 时间 race · 156 0 改动 miniprogram 独立 5 次跑诊断 2/5 fail）· **D-017 v3 §2.4 验证问题响应 SOP 第 6 次完整实战**（105 R1.1 手册修订 → 156 立卡 → R1 实装 → review-tech APPROVE 五步走完）· 105 手册 v1.2 → v1.3（10 处 BLOCKED 清除 + INFO-2 联合时序明示已兑现）· 104 curl-verify v1.4 → v1.5（8 处 URL doc-only sync · 不需 Human 重跑）· backlog v0.2.6 → v0.2.7（156 Doing · 22 卡）· metrics 21 → 22 cards · 累计 14 项 Sprint-2 末 Retro 议题 · §0/§1.1/§1.2/§1.3/§8 全刷新 · 下一步 Human 跑 105 手册 v1.3 联合实测 → 双卡 approve · Sprint-2 主线 4/7 + 5/7 双卡 CLOSED · 累计 14 → 22 点 / 47% → 61% |
| **v1.9** | **2026-05-13 10:25** | 跨会话 Orchestrator | 🟢 **COSTRA-105 R1.1 手册 v1.2 + URL mismatch Human 决策方案 A 落实 + COSTRA-156 占位卡入 Sprint-3 P0 头部** · 105 review-tech 40/40 不变 · 等 Human 实测 · 105 R1.1 手册修订时显式暴露 client/server `/v1` URL 前缀 mismatch 根因三层（L1 协议歧义 + L2 验证盲区 25 处 inject + L3 CI 误判 whitelist 字符串相等）· Human 2026-05-12 16:27 选方案 A（server 加 `/v1` prefix · client 0 改 · 104 不回归 · 105 方式 B 真链路实测 = 等效回归）· 立 FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH（族 A · P0 · 9 项 scope）+ COSTRA-156 占位卡（Sprint-3 头部 · 2 点 · backend-dev · 早于 COSTRA-150）+ 议入 Sprint-2 末 Retro 3 项议题（CI 漏检反模式升 P0 + server 单测 inject 反模式升 P0 + D-022 v2.0 C8-5 端到端契约联调可达性子项扩展 · 累计 12 项 Retro 议题）· 105 手册 v1.2 同步刷 10 处 BLOCKED 注记 · follow-ups Human 整理升级（族 A~H 8 族 · 速查表 14 条 · 归档 sprint-1 closed 968→263 行）· backlog v0.2.4→v0.2.5（156 入 sprint-3 · 11 卡）· 6 闸门全绿 · §0/§1.1/§1.2/§1.3/§8 全刷新 · 下一步 Human 跑实测手册 → `approve:COSTRA-105` |
| **v1.8** | **2026-05-12 15:10** | 新会话 Orchestrator | 🟢 **COSTRA-105 review-tech APPROVE 40/40 满分 @ 15:05 · D-022 v2.0 评分表第 3 次实战首次满分 · qa-planner 首次实装即满分** · 同对话轮 D-014 + D-016 + D-018 同轮兑现完整闭环（派单 14:18 → Card-Review 14:25 PASS-WITH-FOLLOWUP 26/30 → R1 实装 14:55 c046d25 + 73d38d6 → review-tech R1 15:05 APPROVE 40/40）· Card-Review PASS-WITH-FOLLOWUP 路径下 P1/P2/INFO 修订率 100% · 0 业务代码 0 协议改动 · 6/6 + 1 N/A 闸门全绿 · C8 runtime 加载性 5/5 满分 · 1 条 Sprint-3 候选 FU 立件（FU-105-AUTOMATION-FULL-COVERAGE P2 5 点）· 累计 9 项 Sprint-2 末 Retro 议题（含 D-016 反例 7 次升 P0 + SOP-CARD-REVIEW v1.1 follow-up 强制采纳）· §0/§1.1/§1.2/§1.3/§5（待）/§8 全刷新 · 下一步 Human 跑实测手册 5 步 + H1~H5 → `approve:COSTRA-105` |
| **v1.7** | **2026-05-12 13:54** | 新会话 Orchestrator | 🏆 **COSTRA-104 Sprint-2 主线第 3 张 36/40 APPROVE CLOSED · D-022 v2.0 评分表第 2 次实战 + 切出去 3 件套铁律首次实战 9/9 + dev DX 治理三件套范式建立** · `approve:COSTRA-104` Human T1 一次性裁决 · Sprint-2 第 3/7 卡 CLOSED · Human curl 实测 5 步 + 3 硬断言全 PASS · D-017 v3 §2.4 E1 例外路径 4 次实战（R1.x · R1.x.1 · R1.x.2 · R1.x.3 · 全部 ≤ 5 分钟单 commit 收尾）· 4 条 Sprint-3 候选 FU 立件（FU-104-ENTRIES-PATCH/DELETE/SYNC-PULL COSTRA-152/153/154 + FU-EPIC-FAMILY-LEDGER-CRUD COSTRA-155 P0 8 点 scope gap）· 11 主代码 + 文档 + devops 脚本 共 ~ 2055 行净增 · 6 闸门全绿 + 协议 100% 对齐 · SBAI v1.1 第 8 次冒烟 · backend-dev 首次实战 · 审查档第 6 次实战 · D-018 §3.5 越权例外路径多次实战 · 16 commits（6d395bd → 5279343）· §0/§1.1/§1.2/§1.3/§5 全刷新 · 累计 7 项 Sprint-2 末 Retro 议题（D-016 反例 6 次升级 + schema gap CI + setup.ts 反模式 + review-tech 评分维度 ×2 + scope gap 审查 + migrate.sh 幂等）· 下一步 Human 触发 `run qa COSTRA-105`（Sprint-2 主线第 4 张）|

---

**本文件由 Orchestrator 在断点时刻维护 · Human 无需直接编辑 · 新会话接续只需 Read 即可。**
