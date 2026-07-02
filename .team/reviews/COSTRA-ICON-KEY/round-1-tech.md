# Tech Review · COSTRA-ICON-KEY · Round 1

- 被审 Agent：miniapp + backend + devops
- 本轮产出 commit：未提交（工作区基线 HEAD=`5302ead`）
- 审核时间：2026-07-02T08:28:54Z
- 上轮结论：首轮

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：28/35 分
- **阻塞点**：0 个 P0 / 2 个 P1 / 2 个 P2

本轮核心实现方向正确：`CategoryItem.icon` 保持为语义 `icon_key`，`resolveIconGlyph()` 仅在视图模型/展示路径派生 PUA 字形；服务端分类与统计路径对 `icon` 基本保持透传；`0007_category_icon_keys.sql` 的 key 集合与 `categoryService.ts`、`icon-registry.json`、`iconMap.ts` 未发现拼写漂移。

只读验证：

- `npm run typecheck`：通过。
- `cd server && npx tsc -p tsconfig.json --noEmit`：通过。
- 只读脚本核对（四处 key 集合一致，均 81，无 missing/extra）：
  - `icons.mjs` keys = 81
  - `icon-registry.json` keys = 81
  - `iconMap.ts` keys = 81
  - `0007_category_icon_keys.sql` unique keys = 81
  - `categoryService.ts` fallback 配置 unique keys = 81

主要 follow-up 集中在两类：一是权威/方案文档仍有旧口径，二是"图标源单一化"仍有旧 L2 入口未退役。

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---:|---|
| 契约一致性 | 4/5 | `Category.icon` OpenAPI 已更新，服务端透传；但统计排行项 `StatCategoryRankItem.icon` 仍未明确 icon_key 语义。 |
| 架构与分层 | 4/5 | 数据层存 key、视图层 resolve 的分层正确；但图标源"唯一源"仍有 `icons-l2.mjs` 直连残留。 |
| 数据与持久化 | 4/5 | `0007` 幂等 UPDATE、系统分类限定、key 映射一致；但 `docs/db/schema.md` 未同步 0007 与 icon_key 语义。 |
| 离线与同步 | 4/5 | MiniApp 缓存签名继续包含 `icon` key，旧单字兜底安全；本卡不涉及 outbox 写入链路。 |
| 安全与合规 | 5/5 | 未发现新增 `session_key/openid` 泄漏、AppID 泄漏、主体硬编码或敏感日志。 |
| 可测与可观测 | 4/5 | 双端 typecheck 通过，脚本有构建/preview 入口；缺少 `resolveIconGlyph`/迁移映射的自动回归用例。 |
| 工程纪律 | 3/5 | 生成物有 AUTO-GENERATED 标识；但文档/注释存在旧脚本与旧迁移口径，且工作区尚未形成可校验 commit。 |

## P0 阻塞点（必改）

无。

## P1 应改

### P1-1 权威/方案文档仍保留旧口径，未与本轮实际方案完全同步

- **证据**：
  - `docs/design/category-icon-migration-plan.md:5` 仍写"尚未实现"。
  - `docs/design/category-icon-migration-plan.md:28` 架构图仍写 `build.mjs`。
  - `docs/design/category-icon-migration-plan.md:166-168` 仍要求修改 `0001/0004 seed`，与本次 Human 锁定的"0001/0004 历史 seed 保留单字基线不改，靠 0007 最后收敛"相冲突。
  - `docs/design/category-icon-migration-plan.md:239-241` Phase 清单仍写"改 `build.mjs`"和"categories.yaml + 0001/0004 seed + 0007"。
  - `docs/db/schema.md:153` 仍只写 `categories.icon` 为"图标键（对齐 docs/design/design-system.md）"，未明确本轮语义已切为 `icon_key`。
  - `docs/db/schema.md:300-306` 迁移清单未包含当前实际 `0007_category_icon_keys.sql`，且仍列出与当前目录不一致的旧编号。
- **问题**：本卡是数据语义迁移，文档属于后续发布、回滚、DB 维护的事实依据。当前文档同时存在"未实现""旧 build.mjs""改 0001/0004 seed"等旧口径，容易导致后续 Agent 或 Human 按错误顺序执行，特别是误改历史 seed 或误用已删除的 `build.mjs`。
- **依据**：审核维度 Data（DB 变更应伴随 migration + `docs/db/schema.md` 同步）；本卡关键设计不变量（0001/0004 历史 seed 保留、0007 最后收敛）；`docs/design/category-icon-migration-plan.md:222-230` 已正确写出发布顺序，其他章节需与之统一。
- **修复建议**：
  1. 将 `docs/design/category-icon-migration-plan.md` 从"评审稿/尚未实现"更新为"落地稿/已实现"。
  2. 全文替换旧 `build.mjs` 口径为 `build-svg.mjs + build-font.py + build.sh`。
  3. 明确 `0001/0004` 不改历史单字 seed，`0007` 是最终收敛迁移；删除或改写 `166-168`、`239-241` 的旧描述。
  4. 更新 `docs/db/schema.md`：`categories.icon` 说明改为"系统分类迁移后存语义 icon_key；旧单字仅作为历史 seed/回滚兼容"，并补充 `0007_category_icon_keys.sql` 到迁移清单。

### P1-2 图标源"单一化"仍有 `icons-l2.mjs` 直连入口，存在双源漂移风险

- **证据**：
  - 方案要求原 L2 源退役或 re-export：`docs/design/category-icon-migration-plan.md:115-117`。
  - 当前 `icons.mjs` 仍直接 import L1/L2 源：`scripts/icon-font/icons.mjs:13-14`。
  - 旧二级预览脚本仍把 `icons-l2.mjs` 当"权威定义"读取：`scripts/icon-font/gen-demo-l2.mjs:4-5`、`scripts/icon-font/gen-demo-l2.mjs:13`。
  - 旧二级 PNG 预览也仍直接 import L2：`scripts/icon-font/preview-l2.mjs:10`。
- **问题**：本轮关键决策是"图标源单一化 + 二级去重复用"，但仓库内仍存在多个可被维护者误认为权威的入口。虽然新字体构建路径 `build-svg.mjs` 已从 `icons.mjs` 读取，但评审/预览脚本仍绕过 `icons.mjs` 读取 `icons-l2.mjs`，后续若只改 `icons.mjs` 或只改 `icons-l2.mjs`，很容易出现预览、构建、registry 三者漂移。
- **依据**：本卡关键设计不变量（合并 L1 + L2 为唯一源 `icons.mjs`）；`docs/design/category-icon-migration-plan.md:136-137` 明确"构建只读 `icons.mjs`，不再正则解析 HTML"，但旧预览脚本未跟进。
- **修复建议**：
  1. 二选一收敛：
     - 方案 A：真正把 81 个 SVG 都内联到 `icons.mjs`，`icons-l1.mjs/icons-l2.mjs` 删除或改成从 `icons.mjs` 派生 re-export。
     - 方案 B：明确 `icons-l1.mjs/icons-l2.mjs` 是私有分片源，所有脚本只 import `icons.mjs`，旧脚本改为从 `ICONS` 派生分组数据。
  2. 将 `gen-demo-l2.mjs`、`preview-l2.mjs` 改为读取 `icons.mjs`，或标注 deprecated 并从常用构建/评审路径移除。
  3. 在 `build-svg.mjs` 增加 registry ↔ `ICONS` key 集合的双向校验，防止未来新增/删除字形时漂移。

## P2 建议

### P2-1 `StatCategoryRankItem.icon` OpenAPI 未说明 icon_key 语义

- **证据**：
  - OpenAPI 统计排行项仅声明 `icon: { type: string }`：`server/api/openapi.yaml:1357-1369`。
  - 服务端统计 L1/L2 实际返回 `meta?.icon`：`server/src/services/statisticsService.ts:350-353`、`server/src/services/statisticsService.ts:757-763`。
  - 小程序统计页已按 key 解析：`miniprogram/pages/statistics/index.ts:923-927`、`miniprogram/pages/statistics/viewModels.ts:151-154`。
- **问题**：`Category.icon` 契约已更新为语义 `icon_key`，但统计 API 的排行 item 同样暴露分类 icon，却没有同步描述。调用方仅看 OpenAPI 时无法判断这里是 key、旧单字还是字形字符。
- **依据**：OpenAPI 是接口契约第一权威；涉及契约语义变更应保证所有暴露同字段语义的 schema 一致。
- **修复建议**：将 `StatCategoryRankItem.icon` 描述补为"语义 icon_key，与 Category.icon 同源，端侧经 iconMap 映射为 costra-icons 字形；旧数据可能为单字符，客户端需兜底"。

### P2-2 `app.wxss` 注释仍指向已删除旧构建脚本

- **证据**：
  - `miniprogram/app.wxss:11` 注释写"由 scripts/icon-font/build.mjs 生成"。
  - 生成物自身标注为 `build-font.py`：`miniprogram/styles/iconfont.wxss:1`。
  - 新构建脚本实际在 `build-font.py` 写入 wxss：`scripts/icon-font/build-font.py:121-143`。
- **问题**：运行时无影响，但注释会误导维护者去找已删除的旧 `build.mjs`，与本轮 FontForge 两步管线不一致。
- **依据**：工程纪律要求生成产物与构建管线说明准确；删除旧管线后应清理残留引用。
- **修复建议**：将 `app.wxss:11` 改为"由 `scripts/icon-font/build-font.py` 生成，入口见 `scripts/icon-font/build.sh`"。

## 与上轮的差异

Round 1 首轮，无上轮 P0/P1 承接。

## 给被审 Agent 的回执指令

1. 无 P0，禁止扩大改动范围。
2. 优先修复 2 个 P1：
   - 同步 `docs/design/category-icon-migration-plan.md` 与 `docs/db/schema.md` 的实际落地口径；
   - 收敛 `icons-l2.mjs` 直连入口，明确 `icons.mjs` 的唯一源边界。
3. 对每条 P1 产出"修复说明 + diff 指针"。
4. P2 至少修复 `StatCategoryRankItem.icon` 的 OpenAPI 描述；`app.wxss` 注释可同批顺手修。
5. 修复后重新运行 `npm run typecheck`、`cd server && npx tsc -p tsconfig.json --noEmit`、只读 key 集合校验。

## 自我反思

- 本次审核耗时估计：55 分钟
- 置信度：中高
- 说明：代码路径、契约、迁移映射、关键 fallback 均已做只读核对；未实际运行 FontForge 构建和数据库迁移实库验证。建议在修复 P1 后补一次真实 `build.sh` 预览与迁移演练。
