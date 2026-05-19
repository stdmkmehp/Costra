# COSTRA-163 · whitelist-check ICP 强等值校验（FU-DEVOPS-ICP-CROSS-SSOT-CHECK 转正）

> **派单时间**：2026-05-19 20:50（Sprint-3 中段 · devops-ops · ~1 点小卡 · 与 161 同节奏批）
> **状态**：dispatch 已落盘 · 等 Human 拍板启动（D-024 §2.3）
> **依赖**：COSTRA-156 规则 D 范式 · COSTRA-107（ICP 已下证 · `server/src/config/icp.ts ICP_INFO` + `infra/wechat/domains.md §0` 已落）
> **下游解锁**：双 SSOT 字符串漂移自动检测 · 备案号合规巡检支撑

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` | 等启动 |
| **R1 实装** | `costra-devops-ops` | 等卡审 PASS |
| **R1 Review** | `costra-review-tech` | 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-163`（攒批 · 与 161 联合）| 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- 2026-05-13 ICP 下证 · `server/src/config/icp.ts ICP_INFO` + `infra/wechat/domains.md §0` 双 SSOT 落
- 当前 `assertIcpRecorded()` 仅做"子串存在"轻量校验（whitelist-check.mjs:236-254）· 不校验 -1X / -2 子号 · 不与 server icp.ts 交叉
- `domains.md:30-33` 明确点名 "FU-DEVOPS-ICP-CROSS-SSOT-CHECK 跟进强等值校验"

### 1.2 PRD / 契约锚点
- 无（CI 治理议题）
- 腾讯云规范要求"网站底部显著位置"· 备案号字符串若漂移可能违规

---

## §2 Scope（4 项 · 估点 1 · INVEST small）

### 2.1 主交付

#### A · whitelist-check.mjs 加 reconcileIcp() 函数
- 解析 `server/src/config/icp.ts` ICP_INFO 字面量（service / miniapp / subject / filedAt / verifyUrl）
- 解析 `infra/wechat/domains.md §0` 表格（前 60 行内）
- 强等值断言（逐字字符串相等）：service / miniapp / subject / filedAt
- 任一漂移 → exit 1 + 打印 diff（参考现有规则 D 实现）

#### B · 替换 assertIcpRecorded() 轻量校验
- 旧 assertIcpRecorded "子串存在" 删除
- 由 reconcileIcp() 强等值校验取代

#### C · 反向验证脚本
- 临时改 icp.ts ICP_INFO.service → exit 1 + 打印 diff
- 临时改 domains.md §0 备案号 → exit 1
- revert → exit 0

#### D · follow-ups
- FU-DEVOPS-ICP-CROSS-SSOT-CHECK: open → closed @ COSTRA-163

### 2.2 不在本卡范围
- ❌ APM 拨测 GET /v1/legal/icp（FU-DEVOPS-ICP-HEALTH-PROBE · 合 COSTRA-903）
- ❌ nginx X-ICP-Number 头注入（FU-DEVOPS-NGINX-ICP-HEADER · DNS+SSL 触发）

---

## §3 DoD

6 闸门 + G7（reconcileIcp 反向验证 3 项）+ G15。

D-025 扫描预测：AP-001 不命中（事实字段强等值 · 非代理）· AP-002 不命中（明确等值 · 非概率）· AP-003 工程支撑（CI 防漂移）。

---

## §4 强制阅读清单

1. 本派单档 + Card-Review 报告
2. **现有 assertIcpRecorded**：`scripts/devops/whitelist-check.mjs:236-254`
3. **icp.ts**：`server/src/config/icp.ts` ICP_INFO 导出
4. **domains.md §0**：`infra/wechat/domains.md` 表格
5. **规则 D 范式**：`scripts/devops/whitelist-check.mjs` reconcile() 函数（COSTRA-156 commit `edca8da`）

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`scripts/devops/whitelist-check.mjs` · `.team/members/devops-ops/` · `.team/follow-ups/README.md`
- ❌ 不可写：`server/src/config/icp.ts`（仅核验 · 不修订）· `infra/wechat/domains.md`（仅核验）

### §5.2 INVEST small（1 点）
- 时间盒 ≤ 60 分钟

### §5.3 commit footer
- `closes: FU-DEVOPS-ICP-CROSS-SSOT-CHECK`

---

## §6 估点 / 时间盒
- 估点 1 点 · AI ~1 小时 · Human 实测：本地 npm run check:whitelist exit 0 + 反向验证 3 项截图

---

**派单档结束 · 等 Human `start:COSTRA-163`（建议与 161 同链路批量交付 · 都是 whitelist-check.mjs 升级）。**
