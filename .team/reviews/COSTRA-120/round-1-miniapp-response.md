# MiniApp-Agent · Round-1 Response · COSTRA-120

- 被审 Agent：**MiniApp-Agent**（主驾 · 跨区授权 `scripts/devops/` + `.team/decisions/` + `.team/reviews/COSTRA-119/`）
- Dispatch：`.team/dispatch/COSTRA-120-miniapp-fix-tabbar-subpackage-violation.md`
- 响应时间：2026-04-28 14:00~14:xx（Asia/Shanghai · D-016 同轮兑现 · 第 9 次实战）
- 母问题：Human 2026-04-28 13:53 按 COSTRA-119 收官汇报重开微信开发者工具 · 模拟器二次启动失败 · 错误文本 `tabBar pagePath need in ['pages']`（tabBar 指向分包违反微信规约）
- 关联：COSTRA-119 P0 逃逸修复 + D-017 首次实战

---

## 1. 变更清单（9 处 · 每处贴关键片段）

### D1 · 迁移 family-dashboard 到主包（4 新文件）

`miniprogram/pages/family-dashboard/index.ts`：
```typescript
// 主包 · 家庭面板（骨架占位 · tabBar 入口）
// 位置变更：2026-04-28 由 pages-family/dashboard/ 迁入主包（tabBar 页必须在主包 · 微信规约）
// Refs: COSTRA-120（tabBar 分包违规修正） · COSTRA-119（占位四件套源头） · 业务逻辑 Sprint-3 落地（Epic-D COSTRA-201 家庭邀请码 + 成员面板）
Page({
  data: { placeholder: '家庭面板 · 功能建设中 · Sprint-3 落地' },
});
```
其余三件（wxml/wxss/json）与 119 产出完全一致 · 仅路径迁移。

### D2 · 迁移 stat-overview 到主包（4 新文件）

`miniprogram/pages/stat-overview/index.ts`：
```typescript
// 主包 · 统计总览（骨架占位 · tabBar 入口）
// 位置变更：2026-04-28 由 pages-stat/overview/ 迁入主包（tabBar 页必须在主包 · 微信规约）
// Refs: COSTRA-120（tabBar 分包违规修正） · COSTRA-119（占位四件套源头） · 业务逻辑 Sprint-3 落地（Epic-F COSTRA-401 月度饼图/趋势折线）
Page({
  data: { placeholder: '统计总览 · 功能建设中 · Sprint-3 落地' },
});
```

### D3 · 删除原分包空目录（8 文件删 + 2 空目录）

```
deleted: miniprogram/pages-family/dashboard/{index.wxml,wxss,ts,json}
deleted: miniprogram/pages-stat/overview/{index.wxml,wxss,ts,json}
```

### D4 · app.json 三处同步（核心变更）

```diff
   "pages": [
     "pages/login/index",
     "pages/home/index",
+    "pages/family-dashboard/index",
+    "pages/stat-overview/index",
     "pages/entry/index",
     "pages/mine/index"
   ],
   "subpackages": [
     {
       "root": "pages-stat/",
       "name": "stat",
       "pages": [
-        "month/index",
-        "overview/index"
+        "month/index"
       ]
     },
     {
       "root": "pages-family/",
       "name": "family",
       "pages": [
         "home/index",
-        "dashboard/index",
         "settings/index",
         "privacy/index"
       ]
     }
   ],
   "tabBar": {
     "list": [
       { "pagePath": "pages/home/index",             "text": "记账" },
-      { "pagePath": "pages-family/dashboard/index", "text": "家庭" },
-      { "pagePath": "pages-stat/overview/index",    "text": "统计" },
+      { "pagePath": "pages/family-dashboard/index", "text": "家庭" },
+      { "pagePath": "pages/stat-overview/index",    "text": "统计" },
       { "pagePath": "pages/mine/index",             "text": "我的" }
     ]
   }
```

### D5 · CI 脚本扩展 Rule-4（scripts/devops/appjson-pages-check.mjs）

**新增 parseAppJson 返回 tabBar 字段**（~5 行）：
```javascript
const tabBar =
  obj.tabBar && Array.isArray(obj.tabBar.list)
    ? { list: obj.tabBar.list }
    : null;
```

**新增 Rule-4 核心函数**（~20 行）：
```javascript
function checkTabBarMainPackage({ pages, tabBar }) {
  if (!tabBar) return [];
  const mainPagesSet = new Set(pages);
  const violations = [];
  tabBar.list.forEach((item, idx) => {
    if (!item || typeof item.pagePath !== 'string') return;
    if (!mainPagesSet.has(item.pagePath)) {
      violations.push({
        tabIndex: idx,
        pagePath: item.pagePath,
        text: typeof item.text === 'string' ? item.text : '',
      });
    }
  });
  return violations;
}
```

**主流程挂 Rule-4 · 成功文案含 tabBar 段** + **修复指引 ④ 增加 COSTRA-120 规约说明**。

### D6 · miniprogram/README.md 同步（4 行改）

- §1 分包描述：主包增"家庭面板 / 统计总览"
- §3 目录树 `pages/` 条目：增 `family-dashboard/  stat-overview/`；分包条目：删 `dashboard/` / `overview/` 提示
- §4.1 表格 4 行：统计总览 / 月度统计 / 家庭面板 / 家庭 home 路径与状态同步
- §4.1 裁决段：命名差异说明增补 "tabBar 侧已由 COSTRA-120 处理"

### D7 · .team/follow-ups/README.md 同步

- 修订 `FU-COMMON-APP-JSON-DRIFT` 状态备注："L1 文件侧 · L3 tabBar 规约侧由 COSTRA-120 补完"
- 新增 "📌 COSTRA-120 R1 T2 Tech APPROVE 后状态流转" 段位
- 新增 **FU-COMMON-APP-JSON-DRIFT-TABBAR** 条目（同轮登记 + 同轮 closed · resolved_by COSTRA-120）含根因 / 逃逸反思 / 修复八步 / 治理价值

### D8 · D-017 规约新建

`.team/decisions/D-017-verification-problem-response-sop.md`（~200 行）：
- §1 立案背景 · COSTRA-119 P0 逃逸复盘（时间线 + 根因）
- §2 规约正文 · 触发条件 + 五步 SOP（责任识别 → 根因分析 → 多方案 → Human 裁决 → 派单）+ E1/E2/E3 例外 + 时序关系
- §3 责任矩阵（MiniApp/Backend/DevOps/QA 错误关键字映射）
- §4 流程产物规范
- §5 典型反模式（禁止 Orchestrator 自己分析 / 禁止单方案 / 禁止跳过根因 / 禁止单层根因）
- §6 首次实战记录（COSTRA-120）
- §7 演进路径
- §8 决策者归档

### D9 · 119 Review 追写逃逸说明

`.team/reviews/COSTRA-119/round-1-tech.md` 文末追加 §13 "逃逸修正说明"（~60 行）：
- §13.1 本次 Review 漏判事实（三维对照表）
- §13.2 为什么 T2 Review 没抓到（档位局限 + CI 单向性 + 微信规约查证缺失）
- §13.3 后续改进动作（代码 COSTRA-120 + 规约 D-017 + Retro 议题）
- §13.4 对未来 Review 的直接输入（app.json 类 Review 强制清单 3 条）
- §13.5 自我评价 + 版本 v1.1

---

## 2. 五闸证据（全绿 · 含反向验证）

### Gate 1 · 语法闸
```
$ node --check scripts/devops/appjson-pages-check.mjs
(exit 0)
```

### Gate 2 · check:appjson 正向（核心闸 · 本卡价值验证）
```
$ npm run check:appjson
✅ appjson consistent: 10 pages matched across miniprogram/app.json ↔ filesystem · tabBar main-package rule: 4/4 pass
(exit 0)
```
**verbose 扫描明细**：
```
pages[0] → miniprogram/pages/login/index
pages[1] → miniprogram/pages/home/index
pages[2] → miniprogram/pages/family-dashboard/index      ← ✨ 新
pages[3] → miniprogram/pages/stat-overview/index         ← ✨ 新
pages[4] → miniprogram/pages/entry/index
pages[5] → miniprogram/pages/mine/index
subpackages[0]["stat"].pages[0]   → miniprogram/pages-stat/month/index
subpackages[1]["family"].pages[0] → miniprogram/pages-family/home/index
subpackages[1]["family"].pages[1] → miniprogram/pages-family/settings/index
subpackages[1]["family"].pages[2] → miniprogram/pages-family/privacy/index
tabBar 主包规约：4/4 pass                                 ← ✨ Rule-4
```

### Gate 2-反向 · Rule-4 有效性证明（DoD §4 强制）

**Step 1 · 临时把 tabBar[1/2] 改回分包路径**：
```
$ node scripts/devops/appjson-pages-check.mjs
❌ appjson inconsistency detected:
  · [tabBar.list[1] "家庭"] pagePath="pages-family/dashboard/index" 违反微信规约: tabBar 页必须在主包 pages[] · 禁止在 subpackages[].pages[]（启动首帧冲突）
  · [tabBar.list[2] "统计"] pagePath="pages-stat/overview/index" 违反微信规约: tabBar 页必须在主包 pages[] · 禁止在 subpackages[].pages[]（启动首帧冲突）

修复指引：
  ① 为缺失页面新建四件套（.wxml / .json / .ts 必备 · .wxss 可选）
  ② 或从 miniprogram/app.json 的 pages / subpackages 中移除该声明
  ③ 注意 tabBar 指向的页面必须实际存在 · 否则微信开发者工具启动即失败
  ④ [COSTRA-120 规约] tabBar.list[].pagePath 必须在主包 pages[] 数组内 · 禁止在 subpackages · 否则微信开发者工具启动报 "need in ['pages']"
  ⑤ 修复后重跑 `npm run check:appjson`
[EXIT_CODE]=1                           ← ✅ 规则生效
```

**Step 2 · revert 后再跑**：
```
✅ appjson consistent: 10 pages matched ... · tabBar main-package rule: 4/4 pass
[EXIT_CODE]=0                           ← ✅ 正常态恢复
```

### Gate 3 · check:whitelist 回归
```
$ npm run check:whitelist
✅ whitelist consistent: 4 envs, 3 runtime urls matched across 3 sources
   (openapi.yaml: 4 servers · env.ts: 3 apiBaseUrl · domains.md §1.1: 4 rows)
(exit 0)
```

### Gate 4 · typecheck
```
$ npm run typecheck
(exit 0 · 含 2 个新 Page 文件 family-dashboard/index.ts + stat-overview/index.ts)
```

### Gate 5 · vitest
```
$ npm test
 ✓ miniprogram/utils/time.spec.ts  (2 tests)
 ✓ miniprogram/utils/money.spec.ts  (6 tests)
 ✓ miniprogram/services/request.spec.ts  (3 tests)
 ✓ miniprogram/services/auth.spec.ts  (2 tests)

 Test Files  4 passed (4)
      Tests  13 passed (13)
   Duration  160ms
```

### 补充 · 文件迁移完整性证明

```
$ find miniprogram/pages/family-dashboard miniprogram/pages/stat-overview -type f | sort
miniprogram/pages/family-dashboard/index.json
miniprogram/pages/family-dashboard/index.ts
miniprogram/pages/family-dashboard/index.wxml
miniprogram/pages/family-dashboard/index.wxss
miniprogram/pages/stat-overview/index.json
miniprogram/pages/stat-overview/index.ts
miniprogram/pages/stat-overview/index.wxml
miniprogram/pages/stat-overview/index.wxss
                                        ← 8 文件齐

$ find miniprogram/pages-family/dashboard miniprogram/pages-stat/overview -type f 2>/dev/null
                                        ← 空（0 残留）
```

---

## 3. Scope 遵守声明

| 铁律项 | 遵守情况 |
|---|---|
| ❌ 改 tabBar 入口数量/文字 | ✅ 仍 4 项 · 文字 "记账/家庭/统计/我的" 未动 |
| ❌ 改 pages/{home,entry,login,mine}/ | ✅ 未动 |
| ❌ 改 pages-stat/month / pages-family/{home,settings,privacy} | ✅ 未动 · 留分包（非 tabBar · 合规） |
| ❌ 实现 dashboard/overview 真实业务 | ✅ 占位文案保持 "功能建设中 · Sprint-3 落地" · 无业务逻辑 |
| ❌ 改 preloadRule | ✅ 未动（包名仍 stat/family · 即使包内页变少也合法） |
| ❌ 改 sitemap.json | ✅ 未动 |
| ❌ 引入 npm 依赖 | ✅ CI 脚本零依赖（仅 node:fs/path/url） |
| ❌ 动 FU-118-4 其它三例幻觉卡号 | ✅ 仅 overview/dashboard 相关 · month/home 等引用未动 |
| ❌ 写单元测试 | ✅ CI 脚本五闸即测试 · 115/119 先例一致 |

---

## 4. 卡号引用合规证明（FU-118-4 同族教训）

本卡新增/改动的 ts 注释与文案提到的卡号逐一对 backlog.json 核对：

| 文件 | 引用卡号 | backlog.json 存在性 |
|---|---|---|
| `pages/family-dashboard/index.ts` | COSTRA-120 (本卡) / COSTRA-119 / COSTRA-201 | ✅/✅/✅ |
| `pages/stat-overview/index.ts` | COSTRA-120 / COSTRA-119 / COSTRA-401 | ✅/✅/✅ |
| `README.md §4.1` | COSTRA-120 / COSTRA-119 / COSTRA-201 / COSTRA-401 | ✅/✅/✅/✅ |
| `D-017 规约` | COSTRA-119 / COSTRA-120 | ✅/✅ |
| `follow-ups FU-COMMON-APP-JSON-DRIFT-TABBAR` | COSTRA-119 / COSTRA-120 | ✅/✅ |
| `119 Review §13` | COSTRA-119 / COSTRA-120 | ✅/✅ |

**零幻觉**。

---

## 5. 下游影响断言

- **Sprint-3 Epic-D (COSTRA-201 家庭)**：**无影响**。占位页只是路径从 `pages-family/dashboard/` 改到 `pages/family-dashboard/` · 真正的家庭成员面板业务逻辑在 Sprint-3 落地时仍然可以在新路径继续写（甚至更好 · 已经在主包 · 不再需要考虑分包 import）
- **Sprint-3 Epic-F (COSTRA-401 统计)**：**无影响**。同理 · 月度饼图/趋势折线业务在 `pages/stat-overview/index.ts` 继续实现即可
- **分包延迟加载策略**：**无影响**。`preloadRule` 保持 `pages/home/index → stat + family` · 分包包名仍存在（只是包内只剩非 tabBar 页）· 微信小程序允许分包包内只有 1 个页面
- **包大小**：两个占位页从分包挪到主包 · 主包增加约 100 字节 · 远低于 1.5MB 主包红线
- **Human 04-30 COSTRA-102 本地验证**：**前置三重解锁**（100+116+120）· Human 重开微信开发者工具可立即启动模拟器 + 可见 4 个 tab

---

## 6. COSTRA-119 逃逸根因自省（本 Agent 侧）

作为 119 R1 的被审 Agent · 本次反省三点：

1. **根因识别偏差**：119 时看到错误 "未找到 overview/index.wxml" · 直接把 Scope 理解为"补文件" · **未主动做微信规约查证**（tabBar 页能否在分包？）· 119 R1 实装严格按 dispatch §2 Scope 执行 · 属于 dispatch §0 方向偏差导致的连锁错误 —— 但 MiniApp-Agent 作为 app.json 的领域专家 · **有义务在 R1 时反向质疑 dispatch 的根因识别** · 本次未做
2. **T2 档位协作协议需要补强**：未来 MiniApp-Agent 的 R1 产出应包含"dispatch §0 根因识别自查"段 · 若认为根因识别不全面 · 向 Orchestrator 申请方案修订后再实装
3. **对 Review-Agent-Tech 的输入**：119 Review 已在 §13 自省 · 加入"微信官方规约查证"强制项 · 本 Agent 承诺未来涉及 app.json/tabBar 类 R1 时 · 主动在 Response 段列"微信规约核对结果"供 Review 复核

---

## 7. Dispatch 预期回答

**Q: 为什么是 COSTRA-120 而不是 119 的 R2？**
A: 119 已 commit `8bcc5d0` 整卡 Human APPROVED CLOSED @ 2026-04-28 13:48 · D-012 单卡即提交铁律 · 新 bug（tabBar 规约违反 · 与 119 的"文件缺失"属不同根因层）独立卡号 Sprint 复盘更清晰 · Human 2026-04-28 13:59 Q4 明文裁决"新开 COSTRA-120"。

**Q: 为什么 Rule-4 放 appjson-pages-check.mjs 而不是新脚本？**
A: 同一职责族（"app.json 一致性校验"）· 扩增 vs 新建的 YAGNI 权衡 —— 扩增 ~35 行代码 · 复用既有 parseAppJson / main 框架 · 复用同一 package.json script · 复用同一 pr-check.yml step · 未来再有第五/六条规约（如 entryPagePath / preloadRule）继续扩容。新建脚本将导致维护碎片化。

---

## 8. 同轮兑现证据（D-016 第 9 次实战）

- **派单**：2026-04-28 14:00 · Orchestrator 基于 Human 13:59 Q1~Q5 裁决 · 写 `dispatch/COSTRA-120-miniapp-fix-tabbar-subpackage-violation.md`
- **R1 产出**：2026-04-28 14:00~ · MiniApp-Agent 一 tool call 循环内完成 9 处交付
- **Review 拉起**：本 Response 写完即同 tool call 触发 Review-Agent-Tech

所有 D1~D9 · 所有五闸 · 所有 Rule-4 反向验证 · 所有 grep 残留检查 · 所有 lint 检查 · 所有文档同步 · **全部未跨轮**。

---

**MiniApp-Agent · Round-1 Response 提交完毕 · 请 Review-Agent-Tech T2 单轨审**。
