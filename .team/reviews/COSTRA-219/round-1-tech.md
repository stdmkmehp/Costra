# Tech Review · COSTRA-219 · Round 1 · T3 Retrospective

- 被审 Agent：miniapp-dev
- 本轮产出 commit：`d00c47e`（`feat(miniapp): replace hardcoded categories with API + local cache`）
- 审核时间：2026-06-02T13:04:00+08:00
- 上轮结论：首轮（T3 追溯）
- 审核角色：review-tech（只读审查 · Orchestrator 物理落盘）

---

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：30/35 分
- **阻塞点**：0 个 P0 / 0 个 P1 / 5 个 P2 / 3 个 INFO

结论：本卡可按 D-013 T3 追溯档自动关闭。P2 均登记为 follow-up，不阻塞 Family First baseline，也不阻塞 `COSTRA-221` 派单准备。

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---:|---|
| 契约一致性 | 5/5 | CategoryItem 接口与 OpenAPI Category schema 完全对齐（snake_case→camelCase 映射正确，10 字段 1:1）；GET /categories?family_id=uuid query 参数正确透传 |
| 架构与分层 | 4/5 | categoryService / categories / expense-overlay / ledger 四层职责清晰；categoryService.ts 474 行接近 500 行阈值，建议后续拆分 |
| 数据与持久化 | 4/5 | storage.ts envelope 缓存范式正确；per-family cache key 区分家庭；TTL 24h 双保险；fallback UUID 占位符非旧 slug |
| 离线与同步 | 4/5 | 缓存→API→fallback 三级降级链路完整；内存缓存 warmUp 供 getCategoryById 快速查找；warmUp 参数 `_familyId` 未使用（预留扩展点） |
| 安全与合规 | 5/5 | 无 AppID 硬编码、无 session_key/secret 泄漏、无主体硬编码；fallback UUID 占位不误导真实数据；per-family cache key 防跨家庭缓存污染 |
| 可测与可观测 | 3/5 | QA 手册 MP-CAT-01~05 覆盖核心场景；但 categoryService 无独立单测；console.warn 仅 1 处（API 失败降级） |
| 工程纪律 | 5/5 | 单卡独立 commit `d00c47e`；Conventional Commits + Refs: COSTRA-219；无 TODO/FIXME 残留；typecheck+lint+check:appjson+test 95/95 全绿；state.md + history 落盘完整 |

> 维度得分合计：5 + 4 + 4 + 4 + 5 + 3 + 5 = **30/35**。

---

## P0 阻塞点（必改）

无。

## P1 应改

无。

---

## P2 建议

### P2-1 categoryService.ts 无独立单测

- **证据**：未发现 `miniprogram/services/categoryService.spec.ts`。
- **问题**：categoryService 是分类数据核心服务层，包含缓存读写、snake_case→camelCase 转换、树构建、去重映射、fallback 降级等关键逻辑，但无任何单测覆盖。当前主要依赖 QA 手册 MP-CAT-01~05 人工验证覆盖。
- **依据**：dispatch §C6 闸门“既有单测不回归”；D-022 v2.0 可测性维度。
- **修复建议**：新建 `miniprogram/services/categoryService.spec.ts`，至少覆盖：
  1. raw snake_case → camelCase 映射；
  2. `buildCategoryTree` 一级/二级树组装；
  3. `buildDedupMapping` `is_direct_default` 去重映射；
  4. `buildDedupedSubCategories` 同名去重；
  5. `getCategoryById` / `getCategoryIconById` / `getCategoryNameById` 查找 + 降级；
  6. cache TTL 过期判断；
  7. `getCategories` 缓存命中 → API 调用 → fallback 三级降级。

### P2-2 categoryService.ts 474 行接近 500 行阈值

- **证据**：`miniprogram/services/categoryService.ts` 共 474 行，距 500 行阈值仅 26 行余量。
- **问题**：文件包含 fallback 静态数据，若后续家庭自定义分类、缓存策略或 fallback 增强继续增加逻辑，极易突破阈值。
- **依据**：engineering-guidelines 单文件 > 500 行治理要求；audit-217-220 已登记 `FU-219-CATEGORY-SERVICE-LINES`。
- **修复建议**：将 fallback UUID 和 fallback item 构建抽为独立模块 `miniprogram/services/categoryFallback.ts`，预计可降至约 310 行。

### P2-3 buildCategoryTree 中 items.find O(n) 查找可优化

- **证据**：`buildCategoryTree` 在 tier1Map 遍历中通过 `items.find(i => i.id === id)` 二次查找。
- **问题**：当前分类数量约 73 条，运行时无感知；但 tier1Map 构建阶段已遍历 items，可直接记录 type，避免 O(n²) 查找。
- **依据**：dispatch §C1 buildCategoryTree 设计。
- **修复建议**：构建 tier1Map 时同步记录 `type` 信息，例如 `tier1Map.set(item.id, { ...tier1, type: item.type })`，或维护 id→type map。

### P2-4 warmUpMemoryCache 参数 _familyId 未使用

- **证据**：`warmUpMemoryCache(_familyId: string, items: CategoryItem[])` 中 `_familyId` 未实际参与缓存隔离。
- **问题**：当前内存缓存是全局单例，不区分 familyId。若用户切换家庭，旧 family 的缓存不会主动清除。当前业务流每次 `_show` / `onShow` 都会重新加载并 warmUp，天然覆盖，但语义上存在缝隙。
- **依据**：history §4 遗留 P2 已登记。
- **修复建议**：短期记录 `_currentFamilyId`，familyId 变化时清空旧缓存再写入；长期可改为 `Map<familyId, CategoryItem[]>`。

### P2-5 readCache TTL 双保险与 storage.ts TTL 存在冗余

- **证据**：categoryService 内部基于 `timestamp` 判断 `CACHE_TTL_MS`；storage.ts envelope 也支持 `ttl` 字段，但 `writeCache` 未传 `ttlMs` 参数。
- **问题**：TTL 过期当前完全依赖 `readCache` 内判断，逻辑有效，但没有利用 storage.ts 的自动过期清理能力。
- **依据**：storage.ts envelope 设计含 ttl；dispatch §E.4 “TTL 策略: 24h 过期”。
- **修复建议**：`writeCache` 调用 `setItem` 时传入 `ttlMs: CACHE_TTL_MS`，保留 readCache timestamp 双保险，同时让 storage.ts 自动删除过期缓存。

---

## INFO 观察项

### INFO-1 Fallback UUID 占位符设计合理

- **证据**：fallback 使用 `00000000-0000-4000-8000-...` 格式，占位符可辨识，非旧 slug。
- **说明**：Fallback 数据 UUID 格式统一且可辨识，不会与真实 API 返回 UUID 冲突。Fallback 场景下用户可以浏览和选择分类；保存时若服务端拒绝不存在的 category_id，属于可接受降级（比完全白屏好）。
- **处置**：无需修改。若后续需要 fallback 场景也能保存，需后端配合映射。

### INFO-2 console.warn 仅 1 处且合理

- **证据**：categoryService 在 API 失败降级 fallback 时打印 `console.warn('[categoryService] API failed, using fallback data')`。
- **说明**：用于排查“为什么用户看到 fallback 数据而非真实数据”。不泄漏敏感信息。
- **处置**：保留。

### INFO-3 旧 slug ID 清除

- **证据**：旧 slug 字面量不再作为运行时 ID 使用。Fallback UUID 的对象 key 仅作内部映射，不作为 category id。
- **说明**：dispatch §C5 “确保无硬编码字符串 ID 残留”已满足。
- **处置**：确认通过。

---

## D-025 反模式扫描表

| AP | 命中 | 证据 / 否决理由 |
|---|---|---|
| AP-001 字符串代理判定 | ☐ No | 无业务字段字符串硬比较推断语义。`type` 使用枚举 `'income'/'expense'`，`isDirectDefault` / `isSystem` 使用布尔字段。`dedupMapping` 以二级分类名为 key 映射到一级 id，属于设计字典规范映射而非代理判定。 |
| AP-002 概率极低就接受 | ☐ No | 无“概率极低就接受”的边界缺陷。缓存→API→fallback 三级降级链路完整，每级都有明确降级行为。 |
| AP-003 契约-实装漂移 | ☐ No | 前端 CategoryItem 接口与 OpenAPI Category schema 对齐；GET /categories?family_id=uuid query 参数正确透传。 |
| AP-004-X 主体硬编码 | ☐ No | miniprogram 源码无硬编码主体字样。`subject.ts` 是 D-008 可配置设计。 |
| AP-004-Y session_key/secret 泄漏 | ☐ No | 未发现 console.log/warn/error 泄漏 session_key/secret/openid。categoryService 仅 1 处 console.warn 不含敏感信息。 |
| AP-004-Z AppID 硬编码 | ☐ No | miniprogram 源码未发现生产 AppID 硬编码。 |

结论：全部未命中。反模式扫描 PASS。

---

## T3 追溯收口建议

### 是否可自动关闭

| 条件 | 状态 |
|---|---|
| AI-Review PASS | ✅ PASS-WITH-FOLLOWUP 30/35 |
| 残余 P0/P1=0 | ✅ 0 P0 / 0 P1 |
| 无红线 | ✅ 无 AP-004 红线命中 / 无主体硬编码 / 无 AppID 泄漏 / 无 session_key 泄漏 |
| 无新阻塞 | ✅ 5 个 P2 均不阻塞 |

建议：**T3 自动关闭**。

理由：

1. 0 P0 / 0 P1，无红线命中，D-025 反模式扫描全部未命中。
2. Family First baseline 已由 Human 验收通过（三份测试手册全 PASS）。
3. P2-1~P2-5 均登记 follow-up，不阻塞 `COSTRA-221`。
4. 代码质量良好：契约完全对齐、缓存策略合理、降级链路完整、旧 slug 清除、安全无泄漏。

---

## Follow-up 登记

| 编号 | 描述 | 来源 | 严重度 | 建议处置 |
|---|---|---|---|---|
| FU-219-CATEGORY-SPEC | categoryService 无独立单测 | P2-1 | P2 | 下次触及 categoryService 时补 `categoryService.spec.ts`，至少覆盖 7 项核心逻辑 |
| FU-219-CATEGORY-SERVICE-LINES | categoryService.ts 474 行接近 500 行阈值 | P2-2 | P2 | 抽 `categoryFallback.ts` 独立模块，预计降至约 310 行 |
| FU-219-BUILD-TREE-FIND | buildCategoryTree 中 items.find O(n) 可消除 | P2-3 | P2 | 构建 tier1Map 时同时记录 type，消除 items.find |
| FU-219-WARMUP-FAMILY-ID | warmUpMemoryCache `_familyId` 未使用 | P2-4 | P2 | 记录 `_currentFamilyId`，familyId 变化时清空旧缓存 |
| FU-219-CACHE-TTL-REDUNDANCY | writeCache 未传 ttlMs 给 storage.ts | P2-5 | P2 | setItem 时传 `ttlMs: CACHE_TTL_MS`，利用 storage.ts 自动过期清理 |

---

## 证据路径

### 产出文件

- `miniprogram/services/categoryService.ts`
- `miniprogram/components/expense-overlay/categories.ts`
- `miniprogram/components/expense-overlay/index.ts`
- `miniprogram/pages/ledger/index.ts`

### 契约源

- `server/api/openapi.yaml` Category schema
- `server/api/openapi.yaml` GET /categories path

### 参考文件

- `.team/dispatch/COSTRA-219-miniapp-category-model-api.md`
- `.team/members/miniapp-dev/history/2026-06-16-costra-219-category-model-api.md`
- `.team/reviews/audit-217-220.md`
- `.team/reviews/COSTRA-218/round-1-tech.md`
- `qa/current-stage-acceptance-family-first-baseline.md` §6.4 MP-CAT-01~05
- `miniprogram/services/storage.ts`
- `miniprogram/services/request.ts`
- `miniprogram/services/family.ts`
- `miniprogram/config/subject.ts`
- `.team/decisions/D-025-anti-patterns-clipboard.md`

### 闸门验证（history 记录）

- `npm run typecheck`：✅ 0 error
- `npm run lint`：✅ 0 error / 0 warning
- `npm run test`：✅ 95/95 PASS
- `npm run check:appjson`：✅ 14 pages matched · 5/5 tabBar pass

### Commit 验证

- `d00c47e feat(miniapp): replace hardcoded categories with API + local cache`
- Conventional Commits 格式正确
- `Refs: COSTRA-219` 在 commit body 中标注
- 单卡独立 commit（非 chore 合并）

---

## 给被审 Agent 的回执指令

Orchestrator 后续拉起 miniapp-dev 或相关卡时，请附上本文件全文，并要求：

1. 确认 P2-1~P2-5 已知悉并登记 follow-up。
2. P2-1（categoryService 单测）建议在 `COSTRA-221` 实装家庭管理 API时一并补齐，或独立小卡。
3. P2-2（文件行数）建议在下次触及 categoryService 时拆分 fallback 模块。
4. P2-5（cache TTL）建议下次触及缓存逻辑时一并修复，一行改动即可。
5. 所有 P2 记入下一 Sprint backlog。

---

## 自我反思

- 本次审核耗时估计：40 分钟。
- 置信度：高。
- 核心判断：
  1. 代码质量良好，契约完全对齐，缓存策略合理，降级链路完整。
  2. 无红线命中（无主体硬编码、AppID 泄漏、session_key 泄漏）。
  3. 旧 slug ID 清除，符合 dispatch §C5 验收标准。
  4. P2-1（无单测）是最大的可测性缺口，但不阻塞基线（QA 手册已人工覆盖）。
  5. P2-2（文件行数）是预防性问题，当前 474 行未超阈值但余量不足。
  6. D-025 反模式扫描全部未命中，代码规避了已知反模式。

---

**本轮 review-tech:COSTRA-219 完成 · T3 Retrospective · Orchestrator 落盘 · 2026-06-02**
