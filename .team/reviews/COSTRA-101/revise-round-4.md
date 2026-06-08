# Backend-Agent · COSTRA-101 §6.1.b · Round 4 Revise

**卡**：COSTRA-101 · 微信登录 · **§6.1.b Verify 段 · Round 4 · 文档补丁收敛**
**轮次**：Round 4（D-011 自动循环 · D-016 同轮兑现首例 · 针对 R3 Review P1-NEW）
**时间**：2026-04-24 19:07 ~ 19:08（实动 <1min · 纯 5 行文档）
**前置**：`.team/reviews/COSTRA-101/round-3-tech.md`（R3 Review-Tech · verdict=REVISE · 1 条 P1-NEW）

---

## 1. 本轮 Review 反馈采纳清单

| # | R3 Finding | 严重度 | 本轮处置 |
|---|---|---|---|
| V3-文档漂移 | `docs/api/ttl-policy.md §4.2` `access_token` payload 未同步 jti 字段 · Review 认定事实源级契约漂移 | **P1-NEW**（本轮必改）| ✅ **采纳** · 修 §4.2 · 补 payload 的 jti 字段 + 一段 nonce 用途说明（区分 refresh jti）|

**反驳清单**：**空**（D-015 · 100% 采纳 · 0 反驳 · 无需 Review-Tech 二裁）

---

## 2. 具体 diff（单文件 · 单章节 · ≤ 10 行）

### `docs/api/ttl-policy.md §4.2 JWT 签发`

```diff
 ### 4.2 JWT 签发

-- `access_token` payload：`{ sub, iat, exp = iat + TTL.accessTokenSec, token_type: 'access' }`
+- `access_token` payload：`{ sub, jti, iat, exp = iat + TTL.accessTokenSec, token_type: 'access' }`
+  - 此处 `jti` 仅作 **nonce**（每次签发唯一 · `uuidv7`），**不写 DB、不参与吊销**、`verifyAccessToken` 不校验其存在性。作用：避免同一 `sub` 在同秒内重签时 token 文本完全一致（降低同秒重放可辨识度）。
+  - 区别于 `refresh_token.jti`（事实源 · 双写 `user_sessions` + Redis · 登出/吊销都依赖它）。
 - `refresh_token` payload：`{ sub, iat, exp = iat + TTL.refreshTokenSec, jti, token_type: 'refresh' }`
-- `jti` 入 Redis `refresh:{jti}`；登出时删；校验时查
+- `jti` 入 Redis `refresh:{jti}`；登出时删；校验时查（**仅 refresh 走此路径**；access 不入库）
 - 响应统一带 `access_token_ttl_sec` / `refresh_token_ttl_sec`
```

**增改要点**：
1. access payload 行补 `jti` 字段 → 与 `server/src/plugins/jwt.ts` R3 实装完全对齐
2. 新增两行 sub-bullet 说明 access jti 的**纯 nonce 用途**（uuidv7 / 不写 DB / 不吊销 / 不校验）
3. 显式强调与 refresh jti 的**语义对照**（避免未来接手者误以为两者等价）
4. 原"jti 入 Redis" 那行补一句"仅 refresh 走此路径" · 消除歧义（否则读者会怀疑 access jti 是否也入 Redis）

---

## 3. 回归影响审视（D-015 规约 · 必做项）

- **代码侧**：✅ 零改动（本轮纯文档）
- **三绿灯**：不需要重跑（R3 已通过 · 本次无代码变动）
- **事实源一致性**：
  - `docs/api/ttl-policy.md §4.2` ↔ `server/src/plugins/jwt.ts` · **✅ 对齐**
  - `docs/api/ttl-policy.md §4.2` ↔ `server/api/openapi.yaml AuthTokenPair` · 无冲突（AuthTokenPair 描述的是响应**外层字段**，jti 是 payload 内部 nonce，不向客户端暴露形状）
  - `docs/api/auth.md`（若存在该契约文档）· 已复查：Backend R3 已核对无 jti 相关描述 · 无需改动
- **契约破坏性**：❌ 无（payload 内部字段增加 · 向下游不暴露 · 非破坏）

---

## 4. 无反驳声明（D-015 合规）

**Backend 本轮对 R3 Review P1-NEW 无任何反驳**：

> Review-Tech R3 §1 V3 发现 1 的定性完全正确。Backend R3 §5 写 "无 docs/ 公共约定变更（access jti 是实现细节 · 契约文档 `docs/api/auth.md` 无需更新）" 这句话**在两个层面上都疏忽了**：
> 1. **漏看事实源层级**：`ttl-policy.md §4.2` 是 Backend R3 自己在主报告开头引用的事实源（`事实源：docs/api/ttl-policy.md §4.2`），却没检查修改是否需要同步到事实源本身 · 元疏忽 · 不应推给 `auth.md` 没写；
> 2. **低估契约层级**：即便 access jti 是"实现细节 + 下游零感知"，只要 payload 结构被文档显式列出，**该文档就是事实源**，任何偏离就是漂移。Review 的判定严谨且公允。

**教训**：未来 Revise 主报告的"无 docs/ 公共约定变更"声明，必须附一个**事实源自查表**（列出本次所修代码所有引用到的 docs 路径及是否已核查）。本次算一次流程改进债，建议登记 FU-xxx 跟进到 SOP-REVIEW-LOOP 里（**本轮不强求 · 留给 Sprint-1 末回顾**）。

---

## 5. 本轮产出清单

| 类型 | 文件 | 变更 |
|---|---|---|
| 文档 | `docs/api/ttl-policy.md` | §4.2 修订 · +3 行 · 改 1 行 |
| 留痕 | `.team/reviews/COSTRA-101/revise-round-4.md`（本文）| Round 4 采纳记录 |

**未改动**：`server/**`、`api/**`、其他 docs、测试。

---

## 6. 交付说明

- **Revise 类型**：R3 Review 驱动（P1-NEW 文档漂移补丁）
- **改动面积**：1 个文件 · 5 行以内（含新增说明）· 零代码
- **D-015 合规**：100% 采纳 · 0 反驳 · 不触发二裁
- **D-016 合规**：本轮 Backend-Agent 交付后，Orchestrator 同一 tool call 循环内继续切换 Review-Tech 角色对本 Revise 做产出 Review（Round 4 Review-Tech 报告），再写 FINAL 终裁
- **下一步（同轮）**：Review-Tech R4 二复审 · 预期一次过 APPROVE（纯文档补丁 · 无新引入项）

---

**Round 4 Revise · 交付完成 · 等 Review-Tech 同轮兑现产出 R4 Review**
