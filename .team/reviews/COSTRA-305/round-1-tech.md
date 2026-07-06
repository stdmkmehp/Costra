# Tech Review · COSTRA-305 · Round 1

- 被审 Agent：miniapp
- 本轮产出 commit：`927569f28887e17a259e1c2d15fa34d5b16a521d`
- 审核时间：`2026-07-06T07:52:36Z`
- 上轮结论：首轮

## 总评

- **Verdict**：`REJECT`
- **总分**：23/35 分
- **阻塞点**：1 个 P0 / 2 个 P1 / 3 个 P2

本轮聚焦「协作页点击成员头像 → 锚定气泡菜单 → 重命名/退出/解散/移出」链路。功能主路径本身基本闭合：头像 DOM 有 `data-userid/status`，TS 侧按角色生成菜单，破坏性动作均有二次确认，画像更新也订阅了 `PROFILE_UPDATED`。但本轮在已经超长的 `family/index.ts` 内继续追加交互逻辑，并使 `index.wxss` 从 458 行膨胀到 843 行；按 review-tech §3.7，单文件超过 1000 行为 Reject 级违规。因此即使交互链路可读，仍不能进入 PASS/REVISE，需先处理工程红线或由 Human 明确豁免。

> 注：当前工作区存在未提交改动；本报告所有代码行号均以 `git show 927569f:<path>` 指定 commit 为准，而非工作区现状。

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---:|---|
| 契约一致性 | 4/5 | 点击头像链路复用既有 `removeMember/leaveFamily/dissolveFamily/renameFamily` API，未新造错误码；但 `renameFamily` 注释仍写“仅 owner”，与本轮 active 成员可重命名语义不一致。 |
| 架构与分层 | 3/5 | 改动限定在 `miniprogram/`，未越界；但菜单状态、角色矩阵、定位、图标结构继续堆在超大 Page/WXSS 内，组件化/可测边界不足。 |
| 数据与持久化 | 4/5 | 本链路无本地持久化/DB schema 变更；成员移出/退出/解散/重命名后有缓存失效或页面刷新路径，未见明显数据破坏。 |
| 离线与同步 | 5/5 | N/A：本次是在线成员管理 UI，不涉及本地记账写入、`outbox_queue` 或 `client_req_id` 端到端链路；按不适用计满分。 |
| 安全与合规 | 5/5 | 指定三文件未见 `console.log`、`session_key/openid` 明文日志、生产 AppID 或主体硬编码；破坏性动作均有二次确认。 |
| 可测与可观测 | 2/5 | `onTapMember/_buildMemberMenuItems/onMemberMenuTap` 覆盖角色矩阵和破坏性分派，但未见页面级或纯函数单测/用例清单。 |
| 工程纪律 | 0/5 | 触发单文件超限 Reject；文件头/提交元信息仍指向 COSTRA-302/`feat(backend)`，与 COSTRA-305 miniapp 交付不一致且缺少 `Refs: COSTRA-305`。 |

## P0 阻塞点（必改）

### P0-1 单文件超 1000 行，触发 Reject 级工程红线

- **证据**：
  - `miniprogram/pages/family/index.ts:1954`：指定 commit 中文件末尾为第 1954 行。
  - `miniprogram/pages/family/index.wxss:843`：指定 commit 中文件末尾为第 843 行。
  - 提交前后行数对比：`index.ts` 1647 → 1954，`index.wxss` 458 → 843。
- **问题**：本次点击成员头像链路继续把菜单状态、角色矩阵、定位算法、破坏性动作分派和大量 icon WXSS 堆入 `pages/family/index.*`。其中 `index.ts` 已远超 1000 行，`index.wxss` 也超过 500 行，并且本轮显著放大体量。按 review-tech §3.7，“单文件 > 500 行扣分，> 1000 行 Reject”，该项为硬阻塞。
- **依据**：review-tech §3.7 工程纪律：单文件 > 500 行 = -1；> 1000 行 = Reject。
- **修复建议**：
  1. 至少将成员头像气泡菜单拆出到独立组件/样式文件，例如 `miniprogram/components/member-menu/`，Page 只保留事件入口和业务分派。
  2. 将 `_buildMemberMenuItems` 的角色矩阵抽为可单测纯函数，降低 Page 方法体复杂度。
  3. 将 `.member-menu*`、`.mm-*` 图标样式迁出 `pages/family/index.wxss`，避免页面样式继续膨胀。
  4. 若 Orchestrator/Human 认定历史超长文件暂不处理，需在本轮审核前明确给出豁免；否则按当前规约不能 PASS。

## P1 应改

### P1-1 COSTRA-305 交付元信息与文件头/提交卡号不一致

- **证据**：
  - `miniprogram/pages/family/index.ts:2-6`：文件头仍写 `卡号: COSTRA-302` 与 `Refs: COSTRA-302`。
  - `miniprogram/pages/family/index.wxml:1-3`：文件头仍指向 COSTRA-302。
  - `miniprogram/pages/family/index.wxss:1-3`：文件头仍指向 COSTRA-302。
- **问题**：本轮被审卡号是 COSTRA-305，但核心文件头仍全部标注 COSTRA-302；提交主题也为 `feat(backend): ...`，与 miniapp 点击头像交互改造不匹配，且提交信息未见 `Refs: COSTRA-305` footer。后续审计会难以区分 COSTRA-302 L1 下钻、COSTRA-305 头像交互和后端改动。
- **依据**：
  - `.team/engineering-guidelines.md:45-50`：一卡一 commit，commit message 必须含卡号 `Refs: COSTRA-xxx`。
  - `.team/engineering-guidelines.md:74-89`：Conventional Commits scope 与 footer 规范。
- **修复建议**：
  1. 修正本次 miniapp 交付提交信息，scope 应为 `miniapp` 或经 Orchestrator 明确的聚合 scope。
  2. footer 增加 `Refs: COSTRA-305`。
  3. 文件头保留历史背景可以，但需补充本轮变更卡号，例如 `Refs: COSTRA-302, COSTRA-305`，避免审计断链。
  4. 后端 L1 下钻与 miniapp 头像交互若属于不同卡，后续 revise 应拆成独立 commit。

### P1-2 成员头像菜单角色矩阵与破坏性动作缺少可测入口

- **证据**：
  - `miniprogram/pages/family/index.ts:1520-1558`：`onTapMember/_buildMemberMenuItems` 决定 self/owner/active 成员数量下菜单项。
  - `miniprogram/pages/family/index.ts:1613-1627`：`onMemberMenuTap` 分派到重命名、退出、解散、移出成员。
  - `miniprogram/pages/family/index.ts:1630-1699`：移出、退出、解散均为破坏性动作。
- **问题**：该链路覆盖“owner 单人/owner 多人/普通成员/点自己/点他人/left 成员”等多分支，并且会触发破坏性 API。当前实现全部内嵌在 Page 方法中，未见针对菜单矩阵和分派逻辑的单测或最小用例清单，后续修改很容易误把普通成员开放成移出/解散入口。
- **依据**：
  - `docs/design/family-page-tech-spec.md:666-672`：DoD 要求协作页退出/邀请/创建/重命名无回归，并要求 typecheck/lint/现有 vitest 全绿。
  - `package.json:11-12`：项目已有 `typecheck` 与 `vitest run` 测试入口。
- **修复建议**：
  1. 将 `_buildMemberMenuItems` 抽为纯函数并覆盖至少 5 组用例：left 成员无响应、普通成员点自己、普通成员点他人、owner 单人、owner 多人点自己/他人。
  2. 对 `onMemberMenuTap` 至少补充分派级测试或用例清单，验证 `remove` 使用点击目标 userId，`leave/dissolve` 不误用他人 userId。
  3. 若 Page 单测成本过高，至少在本卡交付说明中列出开发者工具/真机冒烟矩阵与结果。

## P2 建议

### P2-1 `renameFamily` 契约注释仍写“仅 owner”，与本轮 active 成员可重命名不一致

- **证据**：
  - `miniprogram/pages/family/index.ts:1539-1541`：点自己时所有 active 成员都会加入 `重命名账本` 菜单项。
  - `miniprogram/pages/family/index.ts:1734-1737`：页面注释写“全体 active 成员均可触发”。
  - `miniprogram/services/familyApi.ts:454-459`：`renameFamily` 注释仍写“仅 owner 允许调用（后端 assertOwner 守门）”。
- **问题**：UI 与页面注释已经按 active 成员开放，但 API service 注释仍保留 owner-only 语义。虽然不直接影响运行，但会误导后续维护者或 reviewer，导致误判前端越权。
- **依据**：契约一致性要求代码与接口/服务语义保持一致，避免文档漂移。
- **修复建议**：同步更新 `familyApi.ts` 注释为“active 成员可调用；后端按 assertActiveMember 守门；必须传 version”，并注明 COSTRA-305/相关后端卡来源。

### P2-2 `boundingClientRect` 失败路径没有清理 `_memberMenuUserId`

- **证据**：
  - `miniprogram/pages/family/index.ts:1531-1532`：点击时先写入 `_memberMenuUserId`，再调用 `_openMemberMenu`。
  - `miniprogram/pages/family/index.ts:1572-1576`：选择器查询回调里 `if (!rect) return;`，未回滚 `_memberMenuUserId` 或给出降级反馈。
- **问题**：正常情况下 selector 能命中；但若用户 id 特殊字符导致 selector 失败、DOM 尚未稳定或 scroll-view 渲染异常，内部 `_memberMenuUserId` 会残留为上次点击目标，而菜单未显示。下一次点击会覆盖，风险不高，但属于状态机不闭合。
- **依据**：交互状态应在失败路径保持自洽，避免隐藏状态残留影响后续破坏性动作。
- **修复建议**：在 `!rect` 分支调用轻量 reset，例如清空 `_memberMenuUserId`、`activeMemberUserId`，必要时 fallback 到居中菜单或 toast；同时考虑对 selector id 做安全转义/改用 class + dataset 方式定位。

### P2-3 WXSS 中重复定义 caret 伪元素位置，存在样式噪音

- **证据**：
  - `miniprogram/pages/family/index.wxss:729-732`：`.mm-rename__caret::before/::after` 的 `top/bottom` 定义重复出现两遍。
- **问题**：重复规则不改变最终渲染，但在已经超长的页面样式中增加噪音，也会干扰后续视觉调整定位。
- **依据**：工程纪律要求保持样式文件可维护，避免无意义重复。
- **修复建议**：删除重复的两行，仅保留一组 `.mm-rename__caret::before { top: 0; }` 与 `.mm-rename__caret::after { bottom: 0; }`。

## 给被审 Agent 的回执指令

Orchestrator 拉起 miniapp-dev 时，请附上本文件全文，并要求其：

1. 优先处理 P0：将成员头像气泡菜单相关 TS/WXML/WXSS 从超长 `family/index.*` 中拆出，或请 Human 明确给出单文件超限豁免；无豁免时本轮不能 PASS。
2. 对 P0 产出“修复说明 + diff 指针”，说明拆分后 `index.ts` / `index.wxss` 行数变化。
3. 对 P1 至少修复 2/2：
   - 修正 COSTRA-305 提交/文件头审计信息；
   - 补充菜单角色矩阵与破坏性动作分派的测试或冒烟用例清单。
4. P2 全部记入下一 Sprint backlog；若同轮修改成本低，建议顺手修复 `renameFamily` 注释、selector 失败清理和 WXSS 重复规则。
5. revise commit 必须独立提交，commit message 包含 `Refs: COSTRA-305` 与 `Review: round-1-revise`。

## 自我反思

- 本次审核耗时估计：35 分钟
- 置信度：中
- 置信度说明：当前工作区有未提交改动，无法在不写盘的前提下 checkout 到 `927569f` 精确运行 typecheck/lint；我已使用 `git show 927569f:<path>` 抽取证据并避免工作区污染。功能主路径判断置信度较高；构建门禁结果需 Orchestrator/被审 Agent 在干净工作树上复跑确认。
