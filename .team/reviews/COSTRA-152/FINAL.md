# COSTRA-152 · 终审报告（FINAL）

> **卡号**：COSTRA-152（Sprint-3 头部第 3 张 · P1 story · 3 点 · backend-dev）
> **标题**：PATCH /entries/{entry_id} 实装（替代 COSTRA-104 R1 stub 501 · FU-104-ENTRIES-PATCH 转正）
> **裁决**：✅ **APPROVED**（Human T1 终审 · 2026-05-23 16:15 · 联合 COSTRA-153 双卡同轮）
> **Sprint**：Sprint-3 · 3/9 卡 CLOSED（154+150 等 staging · 152+153 本轮收官）
> **派单档**：`.team/dispatch/COSTRA-152-patch-entries-impl.md` v2.0
> **实测手册**：`docs/qa/costra-152-153-curl-verify.md` v1.0（746 行）

---

## §1 终审结论

| 项 | 值 |
|---|---|
| **terminal_verdict** | `APPROVED` |
| **human_final_decision** | `approve` |
| **human_final_decision_at** | `2026-05-23T16:15:00+08:00` |
| **human_final_decision_path** | 联合 COSTRA-153 双卡同轮 approve（D-024 §2.2 C1 第 4 次实战 · 105+156 / 157+158 / 154+150 / **152+153** 四连）|
| **review_tier** | T1（backend route 实装 · 含 P0 跨 family 守门补丁 · 必走 Human 实测前置）|
| **r1_tech_score** | 37/40 → R1.x.1 后 ≥ 38（D-022 v2.0 评分表第 9 次实战）|
| **r1_tech_verdict** | PASS-WITH-FOLLOWUP → R1.x.1 修订后 PASS |
| **rounds** | 1 R1 + 1 R1.x.1（双胞胎 P1 同 commit `167bf17` 与 153 共修）|

---

## §2 实测验证（Human curl 实测 2026-05-23 16:07~16:15）

### §2.1 验证范式

不依赖 staging / 公网域名 · **本地 server + WX_MOCK_LOGIN=1**（与 154+150 staging 重测路径解耦）。

### §2.2 实测覆盖

| 段 | 测试内容 | 结果 |
|---|---|---|
| §0 前置 | server 起 + 6 migrations 跑齐 + WX mock 启用 | 🟢 PASS |
| §1 健康检查 | curl /v1/healthz → 200 | 🟢 PASS |
| §2 登录 | curl wx-login 拿 TOKEN_A | 🟢 PASS |
| §3 psql seed | user_A entry_A + user_B entry_B（跨 family 测试用）| 🟢 PASS |
| **§4 PATCH 主路径** 4 子步骤 | 200+version+1 / 409+server_version / 400 / 404 | 🟢 PASS |
| **§5 K3 method-override** 2 子步骤 | POST + Override 等价 PATCH / 不带 header 405 | 🟢 PASS |
| **§7 跨 family 守门**（PATCH 部分）| user_A token PATCH user_B entry → 404 | 🟢 PASS |

### §2.3 5 硬断言（H1~H5 中本卡承担 H1+H2+H3+H5）

| 硬断言 | 内容 | 结果 |
|---|---|---|
| **H1** | PATCH 200 + version 严格递增 + 字段更新生效 | 🟢 PASS |
| **H2** | 409 体含 details.server_version（标准 conflict 体 · 与 sync push 体语义一致） | 🟢 PASS |
| **H3** | K3 method-override 等价行为（POST + X-HTTP-Method-Override: PATCH 与 PATCH 完全等价）| 🟢 PASS |
| **H5** | 跨 family 三处守门全 404（GET + PATCH + DELETE 三测 · 安全优先不泄露 entry 存在性）| 🟢 PASS |

---

## §3 关键证据

### §3.1 commit 链

| commit | 内容 |
|---|---|
| `513dd5a` | **R1 实装**（PATCH /entries/{id} + K3 method-override + entryRepo.findById userId 重载守门 · 13 files +1035/-138）|
| `167bf17` | **R1.x.1**（OpenAPI PATCH+DELETE 加 403 Forbidden 响应 · 双胞胎与 153 R001 同 commit · doc-only 1 行 × 2）|
| `cfdb6e1` | **实测手册**（docs/qa/costra-152-153-curl-verify.md v1.0 · 746 行）|

### §3.2 闸门全绿（9/9）

| 闸门 | 结果 |
|---|---|
| G1 typecheck | exit 0 |
| G2 ESLint | stub（COSTRA-117 deferred · 视同 PASS）|
| G3 OpenAPI lint | redocly 未装 · `grep x-deferred.*COSTRA-152` = 0 ✅ |
| G4 server 测 | 70/70 全绿（含 entries-patch 9 测 T1~T8）|
| G5 schema-check | exit 0 |
| G6 whitelist-check | 3 envs / 3 runtime urls matched |
| G7 OpenAPI 实装齐全 | PATCH 路由可达 + EntryUpdate schema + 401/403/404/409 |
| G8 x-deferred 清理 | 0 残留 |
| G15 D-016 反例预防 | state.md 同 commit ✅ |

### §3.3 守门反向验证铁证

实装期反向验证：临时移除 `fm.user_id = $2` → 3 测全 FAIL（PATCH T7 + DELETE T6 + GET T-CROSS-FAMILY）→ revert → 70/70 全绿（守门生效的确定性证明）+ Human curl 实测 §7 真链路再次确认。

---

## §4 范式贡献

- **D-014 同轮范式第 3 次完美收官**（105+156 / 154+150 / **152+153** 三连 · 单一对话轮 Card-Review→R1→Review→R1.x.1 6 阶段全跑通）
- **D-016 100% 修订率连续第 7 张**（105+156+158+154+150+152 累计 6 卡 · 153 第 7 张）
- **D-017 v3 §2.4 E1 极窄修复第 10 次实战**（双胞胎 P1 同 commit）
- **D-022 v2.0 第 9 次实战**（37/40）
- **D-024 §2.2 C1 第 4 次实战**（联合 153 同轮 approve）
- **D-025 AP-003 第 4 次正向兑现**（x-deferred 清零 + stub 替换）
- **本轮新议题入 Sprint-3 末 Retro**：service 层 user/family 守门作为 review-tech C8 维度强约束（COSTRA-104 R1 漏 + review-tech 36/40 漏检 · 153 R2 卡审形式审捕获 + 152 R1 实装一并修补）

---

## §5 follow-up 状态

| FU ID | 状态 |
|---|---|
| FU-104-ENTRIES-PATCH | ✅ closed @ R1 实装（commit `513dd5a`）|
| FU-CROSS-FAMILY-GUARD-COSTRA-104 | ✅ closed @ R1 实装（与 152+153+GET 三处共享守门）|
| FU-152-001~005（dispatch 修订）| ✅ closed @ R1 实装 |
| FU-152-R001（review-tech P1 OpenAPI 403）| ✅ closed @ R1.x.1 commit `167bf17` |
| FU-152-R002（test console.error 残留）| 🟡 P3 留观察（不阻 approve）|
| FU-152-R003（patchEntryBodySchema account_id）| 🟡 P3 留观察（不阻 approve · MVP 不支持改 account_id）|
| FU-K3-TO-K1-UPGRADE | 🟢 保持 open · 留 Sprint-4 评估（§LINKAGE 决策 1）|

---

## §6 Sprint-3 进度

- **本卡 CLOSED 后**：Sprint-3 头部 3/9 卡（154+150 等 staging）· 估点累计 12/29 = 41%（含 152 3pt）
- **联合 153 同轮 approve 后**：Sprint-3 头部 4/9 卡 · 估点累计 14/29 = **48%**（含 153 2pt）
- **下一步**：154+150 staging 重测 + 联合 approve（暂缓 · Human 决策时间窗）→ 整 Sprint-3 头部 6/9 卡 CLOSED · 估点 24/29 = 83%

---

**本卡终审完成 · 等待 Orchestrator 落 backlog Doing→Done + board 顶部条 + HANDOFF v1.22。**
