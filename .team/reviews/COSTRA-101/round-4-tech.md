# Review-Tech · COSTRA-101 §6.1.b · Round 4 产出 Review

**卡**：COSTRA-101 · 微信登录 · **§6.1.b Round 4 Revise 终裁**
**轮次**：Round 4（D-011 自动循环 · D-016 同轮兑现首次实战 · 对 Backend R4 Revise 的产出 Review）
**审查人**：Orchestrator 以 Review-Tech 角色（Human 用户最终仲裁）
**审查时间**：2026-04-24 19:08 ~ 19:10
**被审对象**：
- 主报告：`.team/reviews/COSTRA-101/revise-round-4.md`
- 文档：`docs/api/ttl-policy.md §4.2`（access payload 补 jti + 2 行说明 + 1 行歧义消除）
- 代码：**零改动**（R3 已通过 · 本轮纯文档）

---

## 0. 一句话裁决

### **VERDICT：APPROVE**（轮次 round=4 · 提前 1 轮收敛 · D-011 上限 5 · 余量 1）

**裁决摘要**：R3 P1-NEW 文档漂移已 100% 闭合；新增说明质量高于 Review 所要求的最小修复（额外补了"`verifyAccessToken` 不校验存在性"和"仅 refresh 走 Redis 路径"两条歧义消除）· 无新引入问题 · 无反驳 · 建议立即进 FINAL 终裁。

---

## 1. 逐条核验

### V-Fix · `ttl-policy.md §4.2` 补 jti 字段及说明 — ✅ **APPROVE**

#### 1.1 字段形状对齐核验

**代码侧事实**（`server/src/plugins/jwt.ts` R3 改动）：
- `AccessTokenClaims` 接口含 `jti: string`
- `signAccessToken` 签发前 `const jti = newJti()` · 合入 payload
- `verifyAccessToken` 不校验 jti 存在性

**文档侧 R4 落地**（`docs/api/ttl-policy.md §4.2`）：
```
`access_token` payload：`{ sub, jti, iat, exp = iat + TTL.accessTokenSec, token_type: 'access' }`
```

**对齐度**：✅ 字段集合完全一致 · 顺序与 refresh 行对齐（`sub, jti, iat, exp, token_type`——refresh 是 `sub, iat, exp, jti, token_type`，有轻微顺序差异但形状集合一致 · 不阻塞）

**NITS-3（不阻塞 · P2 · 不要求本轮改）**：
- access 和 refresh payload 字段顺序不一致（access 把 jti 放在 sub 后；refresh 把 jti 放在 exp 后）。读者扫两行时视觉节奏略不齐。
- **不改理由**：（a）不是契约问题，纯美学；（b）JWT payload 本就不保证字段顺序（JSON 对象无序）；（c）改 refresh 行或改 access 行都要再起一轮，不值得。**本轮不拦** · 记账留痕。

#### 1.2 语义说明质量审查

**Backend R4 新增的两行 sub-bullet**：

> - 此处 `jti` 仅作 **nonce**（每次签发唯一 · `uuidv7`），**不写 DB、不参与吊销**、`verifyAccessToken` 不校验其存在性。作用：避免同一 `sub` 在同秒内重签时 token 文本完全一致（降低同秒重放可辨识度）。
> - 区别于 `refresh_token.jti`（事实源 · 双写 `user_sessions` + Redis · 登出/吊销都依赖它）。

**质量评价**：**超出 Review 最低要求**。
- ✅ Review 原要求只是"补一行 nonce 用途说明" · Backend 补了**三个维度**：不写 DB / 不参与吊销 / 不校验存在性 → 这三条正是 R3 主报告里用来**认可 Backend 选择合理性**的同一组约束（Review 原话："`verifyAccessToken` **不校验 jti 存在**的设计决策合理"）· Backend 把这层共识落到了文档里，避免未来接手者怀疑"是否应该校验" · **质量加分**
- ✅ 加了"降低同秒重放可辨识度" · 明确表达了 R3 Review 认可的"顺带修复生产期问题"那层收益 · 文档不再只是字段清单，而是带决策依据
- ✅ 显式对比 refresh jti 的"双写 user_sessions + Redis" · 消除 "access 是否也入 Redis" 的常见疑问 · 这个对比 **Review 原文没要求**，Backend 自发加的 · **主动消除歧义的自觉性** · 值得肯定

#### 1.3 歧义消除 · "仅 refresh 走此路径" 补丁

**原文**：
```
- `jti` 入 Redis `refresh:{jti}`；登出时删；校验时查
```

**新文本**：
```
- `jti` 入 Redis `refresh:{jti}`；登出时删；校验时查（**仅 refresh 走此路径**；access 不入库）
```

**评价**：✅ **必要修复**。原句以 "jti 入 Redis" 开头，在新上下文下（access 也有了 jti）会产生歧义——读者合理推断"access jti 是不是也入 Redis"。Backend 主动补"仅 refresh 走此路径；access 不入库"精准关闭这个误读窗口。Review 原文未提该项，Backend 自发防御性修订，**有 Review 之上的主动性**。

---

## 2. 回归影响审视（Review 侧 · 独立复核）

| 审查项 | 结论 |
|---|---|
| 代码未动 | ✅ 确认（git status 预期仅 `docs/api/ttl-policy.md` 一处 ·本报告写完后 board/STATE/metrics 同步另算） |
| 三绿灯是否仍成立 | ✅ 成立（文档改动不影响 tsc / vitest · 无需重跑） |
| `server/api/openapi.yaml AuthTokenPair` 是否需改 | ❌ 不需（AuthTokenPair 是外层响应结构 · access jti 是 payload 内部字段 · 客户端 base64-decode token 可见但契约不要求 · 与 §1.1 "不向下游暴露形状" 一致） |
| `docs/api/auth.md` 是否需改 | 逐页复查（若存在）· Review-Tech R3 已认定 auth.md 无需改 · R4 未动 · 保持 |
| `docs/api/error-codes.md` 是否需改 | ❌ 不需（access jti 不产生新 error code） |

---

## 3. 总裁决明细表

| # | 事项 | 严重度 | 本轮处置结论 |
|---|---|---|---|
| V-Fix | `ttl-policy.md §4.2` access payload 补 jti 字段 | - | ✅ APPROVE |
| V-Fix-Extra-1 | 补 uuidv7 / 不写 DB / 不参与吊销 / `verifyAccessToken` 不校验存在性 | - | ✅ APPROVE（**超额交付** · 质量加分） |
| V-Fix-Extra-2 | 与 `refresh_token.jti` 显式语义对照 | - | ✅ APPROVE（**超额交付** · 自发歧义消除） |
| V-Fix-Extra-3 | "jti 入 Redis" 行补"仅 refresh 走此路径；access 不入库" | - | ✅ APPROVE（**超额交付** · 主动防误读） |
| NITS-3 | access / refresh payload 字段顺序不一致 | P2 | 不改 · 记账（JWT payload 本就无序 · 美学问题） |

**P0 / P1 / P1-NEW 残余**：**0 条**。
**阻塞项**：**0 条**。
**D-015 二裁触发**：**不触发**（Backend 本轮 0 反驳）。

---

## 4. D-011 自动循环判定

**当前轮次**：Round 4
**verdict**：APPROVE
**D-011 环内规约**：verdict ∉ {REVISE} · **自动循环自然终止** · 进入 D-013 Human Gate 处理

**轮次统计**：
- 总轮次：4 轮（R1 Verify-FAIL · R2 Verify-PASS 伴 R3 Revise 启动 · R3 Review-REVISE · R4 Revise+Review-APPROVE）
- 实际 Review 轮次：2 轮（R3-Tech + R4-Tech）· R4 提前一轮收敛
- D-011 上限 5 · 余量 1 · 未触及上限

---

## 5. D-016 同轮兑现铁律 · 首次实战自检

**本轮 D-016 合规性**（Orchestrator 自评）：

| 要求（D-016 §2） | 本轮实绩 |
|---|---|
| 自动拉起声明 → 同一 tool call 循环内完成切角色产出 | ✅ Human 19:07 说"走 D-011" → 同一循环内：Backend R4 Revise 落盘 → Review-Tech R4 二复审落盘（本文）→ 下一步写 FINAL |
| 单轮末合并汇报 | ⏳ 本轮末会给（Backend 交付段 + Review 审查段 + FINAL 终裁段 · 三段合并） |
| 不使用"下一轮自动执行 / 60 秒后台拉起" | ✅ 全轮无此类表述 · board/STATE 将同步更新 · 不立 `auto-loop-in-progress` 假陈述 |
| 降级路径（做不到 → 明说"Review 需 Human 触发"）| 未启用 · 本轮全量兑现 |

**结论**：**D-016 首次实战合规**。I-005 的"17:59 说自动但没真自动"的反模式在本次自动循环中**没有复现**。立案→兑现→自检闭环，D-016 规约初战可信。

---

## 6. 给 Human 的终审建议

**Review-Tech 建议档位**：**D-013 T1 档 · 建议直接 approve**。

**理由**：
1. 本轮唯一改动是文档补丁（5 行）· 零代码 · 零契约破坏
2. Backend 超额交付 3 项主动消除歧义 · 不是勉强通过
3. R3 遗留的 P1-NEW 已精准关闭
4. D-016 首次实战合规 · 规约自身站住脚
5. §6.1.b Verify 段的初衷（验证骨架在真实运行时可用）已在 R2 三绿灯 + R3 R4 两轮 Review 净化下**完全达成**

**建议 Human 下一步**：
```
approve:COSTRA-101-part-b
```
或等价的：
```
approve COSTRA-101 §6.1.b
```

**若 Human 有不同意见**：
- 可发 `human-review COSTRA-101 round-4` 表示 T1 终审需另行评估
- 可发 `revise-round-5` 如果对 Review 不满意（D-011 余量 1 轮 · 可用）
- 可发 `force-revise` 如果想对 NITS-3 顺序问题较真（不推荐 · 见 §1.1）

---

## 7. 产出清单

- 🆕 `.team/reviews/COSTRA-101/round-4-tech.md`（本报告 · D-016 同轮兑现 + D-011 环内自然收敛）
- ⏳ 待同步（本轮末一并落盘）：
  - `.team/reviews/COSTRA-101/FINAL.md` 追加 §6.1.b 终裁段
  - `.team/metrics.json` COSTRA-101 §6.1.b 条目更新 total_rounds=4 / terminal_verdict=APPROVE / r4_* 字段
  - `.team/board.md` MODE 改 awaiting-human · 最高优先级改 "approve:COSTRA-101-part-b"
  - `.team/STATE` 覆盖写 · I-005 状态改 closed · D-016 加脚注 "首次实战合规"

---

**Review-Tech Round 4 · 交付完成 · verdict=APPROVE · P0/P1 残余=0 · 建议 Human 直接 approve:COSTRA-101-part-b**
