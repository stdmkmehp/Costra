# Costra · Family First 基线阶段整体验收测试文档

> **文档版本**：v1.1  
> **生成时间**：2026-06-01（基于项目状态记录截至 COSTRA-220）  
> **生成者**：qa-planner（SBAI v1.1 · D-018）  
> **验收基线**：B1/B2/B3/B4/C2 + 164/165 + UI 重构全量 + Phase-2 同步/鉴权  
> **Family First 策略**：家庭页优先级 > 统计页 > 我的页（当前不做家庭页/统计页/我的页开发）  
> **D-025 约束**：每条命令/断言有事实源锚点 · 不信纸面 · 不信假设  

---

## §1 当前 Sprint/Card 完成情况与证据

### 1.1 已完成卡总览

| 卡号 | 名称 | Owner | Commit | 测全绿 | Review | Human T1 | 状态 |
|------|------|-------|--------|--------|--------|----------|------|
| **COSTRA-217** | B1/B2 二级分类 + shared_type | backend-dev | `c517c7a` | 108/108 ✅ | R4 PASS 33/35 | 等 | R4 PASS · 无 P0/P1 |
| **COSTRA-218** | B3 后端分类 API | backend-dev | — | 108/108 ✅ | 等 R1 | 等 | R1 实装完成 |
| **COSTRA-219** | B4 前端分类模型替换硬编码 | miniapp-dev | `d00c47e` | 95/95 ✅ | 等 R1 | 等 | R1 实装完成 |
| **COSTRA-220** | C2 明细页真实数据完善 | miniapp-dev | — | 99/99 ✅ | 等 R1 | 等 | R1 实装完成 |
| **COSTRA-164** | Server family bootstrap MVP | backend-dev | `2e71dc8`+`8c8cdce` | 80/80 ✅ | APPROVE 38/40 | 等 165 联合 | R1.x APPROVE |
| **COSTRA-165** | Miniapp family-context service | miniapp-dev | `3472864` | 69/69 ✅ | APPROVE 38/40 | 等 164 联合 | R1 APPROVE |
| **COSTRA-152** | PATCH entries + 跨 family 守门 | backend-dev | `513dd5a`+`167bf17` | 70/70 ✅ | APPROVE 37/40 | APPROVED CLOSED | ✅ |
| **COSTRA-153** | DELETE entries 软删 + 守门 | backend-dev | `ccd80b9`+`167bf17` | 70/70 ✅ | APPROVE 39/40 | APPROVED CLOSED | ✅ |
| **COSTRA-154** | sync/pull 增量拉取 v1.2 | backend-dev | `31fb893` | 56/56 ✅ | APPROVE 38/40 | 等 staging | R1.x.2 完成 |
| **COSTRA-150** | syncScheduler + mutex | miniapp-dev | `2b28210` | 58/58 ✅ | 等 R1 | 等 154 联合 | R1.x.2 完成 |
| **COSTRA-156** | /v1 prefix + whitelist 规则 D | backend-dev | — | — | APPROVE 40/40 | APPROVED CLOSED | ✅ |
| **COSTRA-200~216** | UI 重构 17 张卡 | miniapp-dev | 见 §1.2 | 95/95 ✅ | 多张等 R1 | — | 已交付 |

### 1.2 UI 重构阶段 Commit 链（COSTRA-200~216）

| Commit | 卡号 | 描述 |
|--------|------|------|
| `49ebd51` | 200 | 设计令牌全面重写（暖灰白/油墨暖黑/微信绿） |
| `defab0e` | 201 | Custom TabBar 5 Tab + routing + eventBus |
| `cd1d636` | 202 | 登录页重做（Wordmark + 格言 + 微信绿 CTA） |
| `3f41afb` | 203 | 明细页全新开发（月支出 + 日期分组 + 左滑删除） |
| `cd9cc88` | 204 | 记账覆盖层全新开发（全屏 + 分类网格 + 计算器） |
| `4a65569` | 205 | Wordmark + TabBar 遮挡修复 |
| `063b9e0` | 206 | 覆盖层 4 个 UI 修复 |
| `7ff7cdd` | 206-p1 | swiper 高度动态计算 |
| `614aaae` | 206-p2 | catchtouchmove 阻断滚动修复 |
| `24243fb` | 207 | 移除 swiper 根治分类网格空白 |
| `74a90e4` | 208 | 覆盖层完全重写（flex scroll layout） |
| `b06e181` | 208-p1 | 一级分类四列网格修复 |
| `e84cdd1` | 209 | 分类防键盘遮挡滚动 + 打开重置 |
| `51ccd92` | 210 | 多实例状态同步关闭 |
| `0fef508` | 211 | 分类防遮挡最小滚动 + 丝滑体验 |
| `741fbb3` | 212 | 备注编辑 + 计算器算式 + 滚动动画 |
| `c5902fe` | 213 | 金额单位修复（cents not yuan） |
| `41877e6` | 214 | 统一安全区与自定义导航高度 |
| `a058d50` | 215 | 统一 Tab 页 custom navigation |
| `307fa2b` | 216 | Tab 页标题顶部错位修复 |

### 1.3 当前闸门状态（最近交付记录/历史闸门记录）

| 闸门 | 命令 | 历史记录期望 |
|------|------|-------------|
| Server typecheck | `cd server && npm run typecheck` | ✅ PASS |
| Server test | `cd server && npm run test` | ✅ 108/108 PASS |
| Miniprogram typecheck | `npm run typecheck` | ✅ PASS |
| Miniprogram test | `npm run test` | ✅ 99/99 PASS |
| Miniprogram lint | `npm run lint` | ✅ PASS |
| check:appjson | `npm run check:appjson` | ✅ 14 pages matched · 5/5 tabBar pass |

---

## §2 验收范围 / 非范围

### 2.1 验收范围（IN）

**后端 API 层**：
- Auth：wx-login / refresh / logout + family bootstrap + AuthTokenPair 含 default_family_id/default_ledger_id
- Family：bootstrap 自动建 personal family + ledger + kind 区分 + softDelete kind 守门
- Categories：GET /v1/categories + POST /v1/categories + 权限守门 + 二级层级 + children_count
- Entries：POST/GET/PATCH/DELETE + shared_type + 跨 family 守门 + 乐观锁 version
- Sync：POST /v1/sync/push + GET /v1/sync/pull + change_seq BIGINT watermark + Idempotency-Key
- Users：GET/PATCH /v1/users/me + has_completed_profile
- Legal：GET /v1/legal/icp

**小程序功能层**：
- 登录：wx.login → server auth → token 持久化 → family-context 写入 → globalData 同步
- TabBar：5 Tab custom-tab-bar + 中间 [+] 记账触发 + 毛玻璃效果
- 记账 overlay：全屏覆盖层 + 分类网格（API 数据 + fallback）+ 计算器 + 算式 + 备注 + 账本切换 + 保存
- 分类：categoryService + API 调用 + 本地缓存 + 树构建 + 去重映射 + fallback 降级
- 明细页：月支出汇总 + 日期分组吸顶 + 左滑删除 + 账本名真实显示 + 成员筛选 + eventBus 刷新
- Family-context：setActiveFamily + getActiveFamilyId/LedgerId/Kind/Name + clearActiveFamily + 旧 key 清理
- Sync：syncScheduler 4 触发源 + mutex + debounce + network-recover + outbox 死锁修复
- 安全区：safeArea.ts 统一服务 + custom navigation + overlay 避让

**数据层**：
- Migration 0001~0009 全量（含 0007 family_kind ENUM + 0008 二级分类 clean rebuild + 0009 shared_type）
- 系统分类 73 条（11 一级 + 62 二级）+ is_direct_default 直选映射 55 条

### 2.2 非验收范围（OUT）

- ❌ 家庭页 UI 开发（COSTRA-223 · C5 · Sprint-Family-2）
- ❌ 统计页 UI 开发（COSTRA-225 · C4 · Sprint-Stats）
- ❌ 我的页重做（COSTRA-226 · C6 · Sprint-Mine）
- ❌ 家庭管理 API（COSTRA-221 · D2 · 邀请/接受/移出）
- ❌ 家庭财务聚合 API（COSTRA-222 · D3 · 公共/个人/垫付贡献）
- ❌ 月度/年度统计报表 API（COSTRA-224 · D1）
- ❌ 真实家庭成员列表/头像/灰化（依赖 D2 API）
- ❌ 多账本真实列表切换（当前只有个人账本）
- ❌ 金额千分位格式化（后续 polish）
- ❌ 生产环境数据库操作（需 Human 审批）
- ❌ 微信审核提审（等功能更完整后）

---

## §3 测试环境准备

### 3.1 本地开发环境

```bash
# 1. 确认 Node.js 版本
node --version   # 期望 ≥ 20.0.0（事实源：server/package.json engines.node）

# 2. 安装依赖
cd /Users/weizhao/Desktop/Costra
npm install
cd server && npm install && cd ..

# 3. 启动本地 DB（Docker）
cd server && npm run db:up

# 4. 跑 migration
cd server && npm run db:migrate
# 事实源：server/db/migrations/ 0001~0009 共 9 个 migration 文件

# 5. 启动本地 server
cd server && npm run dev
# 历史记录期望：Server listening on http://localhost:8080
# 事实源：server/src/server.ts 默认端口 8080

# 6. 验证 healthz
curl -s http://localhost:8080/healthz | jq .status
# 历史记录期望："ok"
# 事实源：server/src/routes/healthz.ts
```

### 3.2 微信开发者工具

1. 打开微信开发者工具 → 导入项目 → 选择项目根目录 `/Users/weizhao/Desktop/Costra`（`project.config.json` 在根目录 · `miniprogramRoot` 指向 `miniprogram/`）
2. AppID：`wxf8b0d3e3a83f9941`
3. **关闭**"不校验合法域名"（prod 测试时必须关闭 · dev 环境可开启）
4. 确认 `env.ts:50` CURRENT_ENV 值：
   - ⚠️ **当前源码值为 `'prod'`**（apiBaseUrl = `https://costra.cloud/v1`）· 若需本地开发测试，须手工改为 `'dev'`（apiBaseUrl = `http://localhost:8080/v1`）· 改后勿提交
   - Prod 测试：保持 `'prod'`（apiBaseUrl = `https://costra.cloud/v1`）
5. 编译 → Console 应输出 `[Costra] onLaunch env= dev` 或 `prod`

### 3.3 Prod 环境（可选 · 需 Human 操作）

```bash
# SSH 到服务器
ssh root@49.235.216.20

# 确认 4 容器运行
docker ps --format '{{.Names}} {{.Status}}' | grep costra

# 确认 healthz
curl -s https://costra.cloud/healthz | jq .status
# 历史记录期望："ok"

# 确认 WX_MOCK_LOGIN=0
docker exec costra-server printenv WX_MOCK_LOGIN
# 历史记录期望：0

# 确认 migration 已跑完（0009_entries_shared_type）
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT COUNT(*) FROM categories WHERE is_system = true AND family_id IS NULL"
# 历史记录期望：73
```

---

## §4 自动化检查命令

### 4.1 Server 端

```bash
# TypeCheck
cd /Users/weizhao/Desktop/Costra/server && npm run typecheck
# 历史记录期望：0 error

# 全量单测
cd /Users/weizhao/Desktop/Costra/server && npm test
# 历史记录期望：108/108 PASS
# 包含：
#   - auth-family-bootstrap.test.ts (10 tests) → COSTRA-164 family bootstrap
#   - categories.test.ts (8 tests) → COSTRA-218 categories API
#   - categories-shared-type.test.ts (20 tests) → COSTRA-217 shared_type
#   - entries.test.ts (5 tests) → COSTRA-104 entries CRUD
#   - entries-patch.test.ts (9 tests) → COSTRA-152 PATCH + 守门
#   - entries-delete.test.ts (6 tests) → COSTRA-153 DELETE 软删 + 守门
#   - sync-pull.test.ts (21 tests) → COSTRA-154 sync/pull v1.2
#   - sync.test.ts (7 tests) → COSTRA-104 sync/push
#   - auth.test.ts → COSTRA-101 auth
#   - users.test.ts (10 tests) → COSTRA-158 users
#   - defaults.test.ts (1 test) → 默认配置
#   - routes/legal.icp.test.ts (3 tests) → ICP 披露
```

### 4.2 Miniprogram 端

```bash
# TypeCheck
cd /Users/weizhao/Desktop/Costra && npm run typecheck
# 历史记录期望：0 error

# Lint
cd /Users/weizhao/Desktop/Costra && npm run lint
# 历史记录期望：0 error 0 warning

# 全量单测
cd /Users/weizhao/Desktop/Costra && npm run test
# 历史记录期望：99/99 PASS
# 包含：
#   - services/family.spec.ts → COSTRA-165 family-context
#   - services/auth.spec.ts → COSTRA-165/158 auth 集成
#   - services/syncScheduler.spec.ts → COSTRA-150 sync 调度
#   - services/db.spec.ts → COSTRA-103 本地 DB
#   - services/outbox.spec.ts → COSTRA-103 outbox
#   - services/storage.spec.ts → COSTRA-125 async envelope
#   - services/request.spec.ts → 请求层
#   - components/expense-overlay/calc.spec.ts (19 tests) → 计算器
#   - utils/money.spec.ts (6 tests) → 金额工具
#   - utils/time.spec.ts (2 tests) → 时间工具
#   - utils/safeArea.spec.ts (7 tests) → COSTRA-214 安全区

# app.json 一致性检查
cd /Users/weizhao/Desktop/Costra && npm run check:appjson
# 历史记录期望：14 pages matched · 5/5 tabBar pass
```

### 4.3 契约一致性检查

```bash
# OpenAPI 与实装路由对比（人工）
cd /Users/weizhao/Desktop/Costra
grep -n "^  /" server/api/openapi.yaml | head -20
# 历史记录期望已实装路径：
#   /auth/wx-login, /auth/refresh, /auth/logout
#   /users/me, /categories, /entries, /entries/{entry_id}
#   /sync/push, /sync/pull, /legal/icp, /healthz

# 已知隐性漂移（AP-003）：
#   /families, /families/{id}, /families/{id}/invites,
#   /families/invites/accept, /families/{id}/members/{uid}
#   → OpenAPI 已定义但无 routes 实装 · 无 x-deferred 标记
#   → 推 COSTRA-221 (D2) 实装时一并处理
```

---

## §5 后端 API 测试用例

### 5.1 Auth（鉴权）

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| API-AUTH-01 | wx-login 首登 bootstrap | POST /v1/auth/wx-login {code} | 200 + AuthTokenPair 含 default_family_id + default_ledger_id + user + kind='personal' | authService.ts:201-210 |
| API-AUTH-02 | wx-login 重登命中已有 family | 同一 code（或新 code 同 openid）再次登录 | default_family_id 与首登一致 · DB 不新增 family/ledger | auth-family-bootstrap.test.ts T2 |
| API-AUTH-03 | refresh 返 family IDs | POST /v1/auth/refresh {refresh_token} | 200 + AuthTokenPair 含 default_family_id + default_ledger_id | authService.ts:256-277 |
| API-AUTH-04 | logout 清 session | POST /v1/auth/logout | 204 | auth.ts:78-90 |
| API-AUTH-05 | 无 token 请求 | GET /v1/entries 无 Authorization | 401 UNAUTHENTICATED | entries.ts parseUserId |
| API-AUTH-06 | 非法 token | GET /v1/entries Authorization: Bearer invalid | 401 UNAUTHENTICATED | entries.ts parseUserId |

### 5.2 Family Bootstrap

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| API-FAM-01 | 首登建 personal family | wx-login 新用户 | DB families +1 (kind='personal') + family_members +1 (role='owner') + ledgers +1 | auth-family-bootstrap.test.ts T1 |
| API-FAM-02 | personal family 不可删 | 调 familyRepo.softDelete personal family | 抛 FAMILY_PERSONAL_NOT_DELETABLE · DB 不变 | auth-family-bootstrap.test.ts T10 |
| API-FAM-03 | shared family 可软删 | 调 familyRepo.softDelete shared family | 成功 · deleted_at 非空 · version+1 | auth-family-bootstrap.test.ts T10 |
| API-FAM-04 | race condition 自愈 | 并发两次 createPersonalFamily 同一 owner | 第二次 unique violation → catch → findPersonalFamily 返回首次创建 | auth-family-bootstrap.test.ts T6 |
| API-FAM-05 | 个人 family 存在但 ledger 缺失 | DB 手动删 ledger 后重登 | 自愈补建 ledger · response 返回新建 ledger_id | auth-family-bootstrap.test.ts T3 |
| API-FAM-06 | kind 区分持久化 | 首登后查 DB | kind='personal' · 用户主动创建走 DEFAULT 'shared' | auth-family-bootstrap.test.ts T9 |

### 5.3 Categories（分类 API）

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| API-CAT-01 | 获取系统分类 | GET /v1/categories?family_id=xxx | 200 + 73 条系统分类 + children_count | categories.test.ts T3 |
| API-CAT-02 | 无 token | GET /v1/categories 无 Authorization | 401 | categories.test.ts T1 |
| API-CAT-03 | 无 family_id | GET /v1/categories 无 query | 400 | categories.test.ts T2 |
| API-CAT-04 | 非成员 family_id | GET /v1/categories?family_id=非自己family | 403 FORBIDDEN | categories.test.ts T4 |
| API-CAT-05 | 创建自定义分类 | POST /v1/categories {family_id, name, type, icon} | 201 + Category | categories.test.ts T5 |
| API-CAT-06 | 禁止三层分类 | POST /v1/categories {parent_id=二级分类id} | 400 不允许三层 | categories.test.ts T6 |
| API-CAT-07 | 同名重复 | POST /v1/categories 同名同 parent | 409 或 DB 约束错误 | categories.test.ts T7 |
| API-CAT-08 | children_count 正确 | GET /v1/categories | 一级分类 children_count = 其下二级数量 | categories.test.ts T8 |

### 5.4 Entries + shared_type

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| API-ENT-01 | 创建 entry + shared_type | POST /v1/entries {shared_type: 'personal'} | 201 + shared_type 返回 | categories-shared-type.test.ts |
| API-ENT-02 | shared_type 默认规则 | POST /v1/entries 不传 shared_type | personal family → 默认 personal | entryService resolveDefaultSharedType |
| API-ENT-03 | income 不可 shared | POST /v1/entries {type: 'income', shared_type: 'shared'} | 400 或服务端拒绝 | 0009 migration CHECK 约束 |
| API-ENT-04 | PATCH entry | PATCH /v1/entries/{id} {note: '新备注', version: 1} | 200 + version=2 | entries-patch.test.ts |
| API-ENT-05 | PATCH version 冲突 | PATCH /v1/entries/{id} {version: 0} | 409 Conflict | entries-patch.test.ts |
| API-ENT-06 | DELETE 软删 | DELETE /v1/entries/{id}?version=1 | 204 + DB deleted_at 非空 | entries-delete.test.ts |
| API-ENT-07 | 跨 family 守门 | PATCH 另一 family 的 entry | 403 FORBIDDEN | entries-patch.test.ts 跨 family 守门 |

### 5.5 Sync（同步）

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| API-SYNC-01 | push create | POST /v1/sync/push {ops: [{op:'create', entity:'entry', ...}]} | 200 + results[0].status='ok' | sync.test.ts |
| API-SYNC-02 | push 幂等 | 同一 Idempotency-Key 重复 push | 返回缓存结果 · DB 不重复 | sync.test.ts |
| API-SYNC-03 | pull 增量 | GET /v1/sync/pull?family_id=xxx&since=0&limit=200 | 200 + watermark(BIGINT) + changes | sync-pull.test.ts |
| API-SYNC-04 | pull since≠0 增量 | GET /v1/sync/pull?since=上次watermark | 仅返回增量 · pulled ≤ 全量 | sync-pull.test.ts |
| API-SYNC-05 | push 含 shared_type | POST /v1/sync/push payload 含 shared_type | 正确写入 · pull 返 shared_type | categories-shared-type.test.ts |
| API-SYNC-06 | batch 上限 200 | POST /v1/sync/push 201 条 ops | 400 INVALID_ARGUMENT | sync.test.ts |

### 5.6 权限守门

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| API-ACL-01 | 跨 family 读 entries | GET /v1/entries?ledger_id=另一family的ledger | 403 或空列表 | entries.ts userId 过滤 |
| API-ACL-02 | 跨 family PATCH | PATCH /v1/entries/{id} 另一 family entry | 403 FORBIDDEN | COSTRA-152 守门 |
| API-ACL-03 | 跨 family DELETE | DELETE /v1/entries/{id} 另一 family entry | 403 FORBIDDEN | COSTRA-153 守门 |
| API-ACL-04 | 非 member 读 categories | GET /v1/categories?family_id=非自己family | 403 FORBIDDEN | categories.test.ts T4 |
| API-ACL-05 | personal family 不可删 | softDelete kind='personal' family | FAMILY_PERSONAL_NOT_DELETABLE | COSTRA-164 T10 |

---

## §6 小程序功能验收

### 6.1 登录

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| MP-LOGIN-01 | 首次登录全链路 | 清 storage → 打开小程序 → 点击"一键微信登录" | 登录成功 → 跳转 home 页 → Console `[auth] login success` | auth.ts:249 |
| MP-LOGIN-02 | Token 持久化 | 登录后检查 storage | `__costra_token_v1` envelope 含 default_family_id + default_ledger_id | auth.ts:13 + storage.ts:10 |
| MP-LOGIN-03 | family-context 写入 | 登录后检查 storage | `__costra_family_context_v1` envelope 含 family_id + ledger_id + family_kind + ledger_name | family.ts:20 |
| MP-LOGIN-04 | globalData 同步 | 登录后检查 | getApp().globalData.activeLedgerId === default_ledger_id | auth.ts:244-247 |
| MP-LOGIN-05 | 旧 key 清理 | 登录后检查 | `__costra_family_id_v1` 不存在 | family.ts:23 removeItem |
| MP-LOGIN-06 | 旧 token 升级 | 模拟旧 token（无 default_family_id）→ 重启 | initAuth → refreshToken → family-context 透明写入 · 用户不需重新登录 | auth.ts:92-103 |
| MP-LOGIN-07 | logout 清理 | 点击退出登录 | family-context + token + globalData 全清 → 跳登录页 | auth.ts:181-188 |

### 6.2 TabBar

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| MP-TAB-01 | 5 Tab 正常切换 | 点击明细/统计/家庭/我的 Tab | 页面切换正常 · 无白屏 | custom-tab-bar/index.ts |
| MP-TAB-02 | [+] 触发记账 overlay | 点击中间 [+] Tab | 全屏 overlay 弹出 · 不发生页面路由 | eventBus SHOW_EXPENSE_OVERLAY |
| MP-TAB-03 | overlay 打开时 TabBar 隐藏 | [+] 弹出后 | TabBar 隐藏（translateY） | custom-tab-bar/index.ts |
| MP-TAB-04 | overlay 关闭时 TabBar 恢复 | 关闭 overlay | TabBar 恢复显示 | custom-tab-bar/index.ts |
| MP-TAB-05 | 切 Tab 前 overlay 关闭 | overlay 打开 → 切到其他 Tab | overlay 自动关闭 · 不残留 | COSTRA-210 方案 C |

### 6.3 记账 Overlay

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| MP-OVERLAY-01 | 全屏覆盖层 | 点击 [+] | overlay 从底部全屏覆盖 · 无底部绿色残留 | COSTRA-206 修复 |
| MP-OVERLAY-02 | 支出/收入切换 | 点击支出/收入文字指示器 | 切换分类网格 · 支出 8 一级 + 收入 3 一级 | expense-overlay/index.ts |
| MP-OVERLAY-03 | 一级分类四列网格 | 查看分类展示 | 一级分类 4 列 grid · 不纵向单列 | COSTRA-208 修复 |
| MP-OVERLAY-04 | 二级分类展开 | 点击一级分类 | 展示二级分类 · 滚动正常 | expense-overlay/index.ts |
| MP-OVERLAY-05 | 分类防键盘遮挡 | 选择分类后键盘弹出 | 分类区域最小滚动 · 选中项可见 | COSTRA-211 最小位移 |
| MP-OVERLAY-06 | 计算器算式 | 输入 9+9-9 → 按 = | 金额显示 ¥9.00（9 元 = 900 分） | COSTRA-213 修复 |
| MP-OVERLAY-07 | 备注编辑 | 输入备注 → 关闭 → 重新打开备注 | 备注可重复编辑 · 不丢失 | COSTRA-212 修复 |
| MP-OVERLAY-08 | 保存记账 | 输入金额 + 选分类 → 保存 | Console `[entry] saved` + eventBus ENTRY_SAVED + overlay 关闭 | expense-overlay/index.ts |
| MP-OVERLAY-09 | 打开重置 | 保存后再次打开 | 金额/备注/分类重置为初始态 | COSTRA-209 重置 |
| MP-OVERLAY-10 | 关闭按钮避让胶囊 | 查看关闭按钮位置 | 不与微信胶囊重叠 · safe-area 正确 | COSTRA-206 修复 |

### 6.4 分类数据

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| MP-CAT-01 | API 获取分类 | 登录后打开记账 overlay | 分类从 API 获取 · UUID id · 非 slug | categoryService.ts |
| MP-CAT-02 | 本地缓存 | 首次获取后关闭重开 | 读缓存 · 不重复调 API · TTL 24h | categoryService.ts CACHE_TTL_MS |
| MP-CAT-03 | 去重直选映射 | 查看二级分类展示区 | 同名二级仅展示一次（is_direct_default=true 优先） | categoryService.ts buildDedupMapping |
| MP-CAT-04 | API 降级 fallback | 断网 + 清缓存后打开 | 使用内嵌 fallback 数据 · UUID 占位 ID | categoryService.ts getFallbackItems |
| MP-CAT-05 | 无硬编码残留 | grep 搜索 | 无旧 slug ID（'food', 'transport' 等）残留 | COSTRA-219 C5 |

### 6.5 明细页

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| MP-LEDGER-01 | 月支出汇总 | 打开明细页 | 顶部显示当月总支出 · 金额正确 | ledger/index.ts |
| MP-LEDGER-02 | 日期分组吸顶 | 滚动列表 | 日期分组标题吸顶 · 不跳动 | COSTRA-203 |
| MP-LEDGER-03 | 左滑删除 | 左滑一条记录 → 点删除 | 记录删除 · Console `[sync] ok pushed=1` | ledger/index.ts |
| MP-LEDGER-04 | 账本名真实显示 | 查看顶部账本名 | 显示真实名称（非硬编码 '我的账本'） | COSTRA-220 C2 |
| MP-LEDGER-05 | 成员筛选 | 点击成员筛选 → 选"仅看自己" | 仅显示自己的记录 · 汇总数字同步更新 | COSTRA-220 C3 |
| MP-LEDGER-06 | eventBus 刷新 | 记一笔保存后 | 明细页自动刷新 · 无需切 Tab | COSTRA-220 C4 |
| MP-LEDGER-07 | 月份切换 | 切换月份 | 数据刷新 · 滚动到顶部 | COSTRA-220 C5 |
| MP-LEDGER-08 | 分类名/icon 真实 | 查看条目分类 | 显示 API 返回的分类名和图标 · 非 hardcode | COSTRA-219 C4 |
| MP-LEDGER-09 | 空状态 | 无记录月份 | 显示空状态引导文案 | COSTRA-220 C5 |

### 6.6 离线/同步

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| MP-SYNC-01 | 冷启 sync pull | 重启小程序 | Console `[sync] ok pulled=N` | syncScheduler.ts |
| MP-SYNC-02 | 记账 push 上行 | 记一笔 | Console `[sync] ok pushed=1` + DB 有记录 | syncScheduler.ts |
| MP-SYNC-03 | watermark 持久化 | 记账后重启 | pull 请求 since≠0 · 增量拉取 | db.ts watermark key |
| MP-SYNC-04 | 离线记账 | 飞行模式 → 记一笔 | 本地保存成功 · outbox 有待推记录 | outbox.ts |
| MP-SYNC-05 | 网络恢复自动 push | 恢复网络 | Console `[sync] ok pushed=1 (trigger=network-recover)` | syncScheduler.ts wx.onNetworkStatusChange |
| MP-SYNC-06 | 5 分钟稳定性 | 保持前台 5 分钟 | 无 `[sync] fail` · 无 401 · 有 periodic/page-show ok | phase-3-prod-realdevice-test.md §4.5 |

### 6.7 家庭上下文（不含家庭页开发）

| ID | 用例 | 步骤 | 预期 | 事实源 |
|----|------|------|------|--------|
| MP-FAM-01 | 全新登录 family-context | 清 storage → 登录 | storage 有 __costra_family_context_v1 含 family_id + ledger_id + family_kind + ledger_name | family.ts:28 |
| MP-FAM-02 | getActiveFamilyKind | 登录后调用 | 返回 'personal'（个人家庭） | family.ts:65-68 |
| MP-FAM-03 | getActiveLedgerName | 登录后调用 | 返回真实账本名（降级 '我的账本'） | family.ts:74-77 |
| MP-FAM-04 | logout 清理 | 退出登录 | __costra_family_context_v1 被清除 · globalData.activeLedgerId = undefined | family.ts:56-58 + auth.ts:181-188 |
| MP-FAM-05 | syncScheduler 用 family.ts | 检查 syncScheduler 代码 | 不再有 FAMILY_ID_KEY 字面量 · 调 family.ts getActiveFamilyId | COSTRA-165 C |

---

## §7 UI / 交互 / 安全区真机验收

### 7.1 真机矩阵

| 机型 | 系统 | 微信版本 | 基础库版本 | 测试结果 |
|------|------|----------|-----------|---------|
| iPhone 15 Pro | iOS 17.x | 最新稳定 | ≥ 3.4.0 + 向下 2 版 | ☐ |
| iPhone 13 | iOS 16.x | 最新稳定 | ≥ 3.4.0 + 向下 2 版 | ☐ |
| Xiaomi 14 | Android 14 | 最新稳定 | ≥ 3.4.0 + 向下 2 版 | ☐ |
| Huawei P60 | Android 13 | 最新稳定 | ≥ 3.4.0 + 向下 2 版 | ☐ |

> **基础库版本要求**：最新稳定 + 向下 2 个版本（如 3.4.x / 3.3.x / 3.2.x）

### 7.2 UI 验收项

| ID | 检查项 | 预期 | 验收 |
|----|--------|------|------|
| UI-01 | 设计令牌一致性 | 暖灰白 #f1f2ec 背景 · 油墨暖黑 #1c1b1a 文字 · 微信绿 #07C160 CTA | ☐ |
| UI-02 | 登录页 | COSTRA 全大写轻字重 wordmark + 随机格言 + 微信绿 CTA · 极简暖灰白 | ☐ |
| UI-03 | 明细页头部 | 112rpx 巨大月支出 · 日期分组吸顶 · 左滑删除手势流畅 | ☐ |
| UI-04 | 记账 overlay 全屏 | 覆盖全屏 · 无底部残留 · 关闭按钮避让胶囊 | ☐ |
| UI-05 | 分类网格 | 一级 4 列 grid · 二级展开正常 · 防键盘遮挡滚动丝滑 | ☐ |
| UI-06 | 计算器 | 算式输入 · = 后金额正确 · 金额单位为分 | ☐ |
| UI-07 | TabBar 毛玻璃 | 5 Tab 中置式 · 毛玻璃效果 · 选中态油墨黑 | ☐ |
| UI-08 | 安全区 | 自定义导航不顶状态栏 · overlay 不顶刘海 · 底部安全区适配 | ☐ |
| UI-09 | 支出/收入指示器 | 文字切换（非圆点）· 点击可切换 · 当前态高亮 | ☐ |
| UI-10 | 空状态 | 无记录时显示引导文案 · 无多余图标 | ☐ |

### 7.3 安全区专项

| ID | 检查项 | 预期 | 验收 |
|----|--------|------|------|
| SAFE-01 | safeArea.ts 统一服务 | getSafeAreaMetrics() 返回一致值 | ☐ |
| SAFE-02 | 自定义导航高度 | 所有 Tab 页标题不顶状态栏 | ☐ |
| SAFE-03 | overlay 顶部避让 | 关闭按钮不与胶囊重叠 | ☐ |
| SAFE-04 | overlay 底部安全区 | 计算器区域不被 Home Indicator 遮挡 | ☐ |
| SAFE-05 | 开发者工具 vs 真机 | 不依赖 CSS env(safe-area-inset-top) · 用 safeArea.ts | ☐ |

---

## §8 回归矩阵

### 8.1 功能回归

| 功能域 | 覆盖用例 | 自动化 | 人工 |
|--------|---------|--------|------|
| Auth (wx-login/refresh/logout) | API-AUTH-01~06 | ✅ server 10 测 | ☐ 真机 |
| Family Bootstrap | API-FAM-01~06 | ✅ server 10 测 | ☐ 真机 |
| Categories API | API-CAT-01~08 | ✅ server 8 测 | ☐ curl |
| Entries + shared_type | API-ENT-01~07 | ✅ server 20 测 | ☐ curl |
| Sync push/pull | API-SYNC-01~06 | ✅ server 28 测 | ☐ 真机 |
| 权限守门 | API-ACL-01~05 | ✅ server 测覆盖 | ☐ curl |
| 登录全链路 | MP-LOGIN-01~07 | 部分 auth.spec | ☐ 真机 |
| TabBar | MP-TAB-01~05 | — | ☐ 真机 |
| 记账 overlay | MP-OVERLAY-01~10 | ✅ calc.spec 19 测 | ☐ 真机 |
| 分类数据 | MP-CAT-01~05 | — | ☐ 真机 |
| 明细页 | MP-LEDGER-01~09 | — | ☐ 真机 |
| 离线/同步 | MP-SYNC-01~06 | ✅ syncScheduler.spec | ☐ 真机 |
| Family-context | MP-FAM-01~05 | ✅ family.spec 6 测 | ☐ 真机 |

### 8.2 九类覆盖检查

| 覆盖类型 | 覆盖情况 | 证据 |
|----------|---------|------|
| 等价类 | ✅ 支出/收入 · personal/shared · 一级/二级分类 | API-CAT / API-ENT |
| 边界 | ✅ batch 上限 200 · 分类三层禁止 · 金额 cents 整数 | API-SYNC-06 / API-CAT-06 |
| 异常 | ✅ 无 token · 非法 token · API 不可达 · refresh 失败 | API-AUTH-05/06 / MP-CAT-04 |
| 幂等 | ✅ Idempotency-Key 重复 push · migration 连续执行 | API-SYNC-02 / 0008 幂等 |
| 并发 | ✅ race condition createPersonalFamily · unique violation 自愈 | API-FAM-04 |
| 兼容 | ✅ 旧 token 升级 · 旧 key 清理 · fallback 降级 | MP-LOGIN-06 / MP-FAM-01 |
| 安全 | ✅ 跨 family 守门 · 非 member 403 · personal family 不可删 | API-ACL-01~05 |
| 弱网 | ✅ 离线记账 · 网络恢复 push · API 失败 fallback | MP-SYNC-04/05 / MP-CAT-04 |
| 授权拒绝 | ✅ 非 member 读 categories 403 · 跨 family 操作 403 | API-ACL-04 / API-ACL-02 |

---

## §9 缺陷记录模板

```markdown
# 缺陷单 · YYYY-MM-DD-xxx-brief

## 基本信息

| 字段 | 值 |
|------|---|
| 缺陷 ID | D.YYYY-MM-DD-xxx |
| 严重度 | P0 / P1 / P2 |
| 关联需求 | COSTRA-xxx |
| 责任 Agent | backend-dev / miniapp-dev |
| 状态 | Open / Fixed / Closed |

## 复现步骤

1. 
2. 
3. 

## 预期结果


## 实际结果


## 截图路径

- 

## 日志

```
粘贴相关 Console / Network / Server 日志
```

## 真机信息

| 机型 | 系统 | 微信版本 | 基础库版本 |
|------|------|----------|-----------|
|  |  |  |  |

## 修复记录

| 时间 | 修复内容 | Commit |
|------|---------|--------|
|  |  |  |
```

---

## §10 当前遗留与后续 Sprint 规划

### 10.1 当前遗留问题

| 编号 | 遗留 | 严重度 | 影响 | 后续处理 |
|------|------|--------|------|---------|
| L-01 | OpenAPI /families/* 6 端点无实装 · 无 x-deferred 标记（AP-003） | P2 | 契约漂移 | COSTRA-221 (D2) 实装时一并处理 |
| L-02 | FALLBACK_LEDGER_ID 仍保留（防御层） | P3 | 极边缘场景走 fallback → server 拒绝 | FU-165-LEDGER-FALLBACK-CLEANUP · 等 family 切换 UI 后删除 |
| L-03 | 金额千分位格式化未做 | P3 | 大金额显示不友好 | 后续 polish 卡 |
| L-04 | 真实家庭成员列表/头像/灰化 | P1 | 明细页成员筛选仅 '全部/仅看自己' | 依赖 D2 API → C5 家庭页 |
| L-05 | 多账本真实列表切换 | P2 | 当前只有个人账本 · 切换仅改文字 | 依赖 D2 family list API |
| L-06 | COSTRA-217 review-tech R4 已 PASS 33/35（无 P0/P1）；COSTRA-218/219/220 review-tech R1 未完成 | P1 | 218/219/220 代码质量未独立审查 | 等 Orchestrator 安排 review |
| L-07 | COSTRA-164+165 联合 Human T1 实测未完成 | P0 | family bootstrap 真链路未真机验证 | 需 Human 执行 phase-3 实测手册 |
| L-08 | COSTRA-154+150 联合 Human staging 实测未完成 | P0 | sync v1.2 协议未真机验证 | 需 Human 执行 |

### 10.2 后续 Sprint 规划（Family First 路线）

```text
当前基线：B1/B2/B3/B4/C2 ✅ + 164/165 ✅ + UI 重构 ✅ + 同步/鉴权 ✅
  │
  ├─ Sprint-Family-1：家庭域后端基础
  │   ├─ COSTRA-221 · D2 家庭管理 API
  │   │   GET /v1/families · GET /v1/families/{id}/members
  │   │   POST /v1/families · POST /v1/families/{id}/invites
  │   │   POST /v1/family-invites/{id}/accept
  │   │   DELETE /v1/families/{id}/members/{user_id}
  │   │   验收重点：personal 不可删/不可邀请 · 非 member 不可读 · left_at 成员保留
  │   │
  │   └─ COSTRA-222 · D3 家庭财务聚合 API
  │       GET /v1/families/{id}/summary?month=YYYY-MM
  │       公共/个人/成员支出/垫付贡献/收入结余
  │       验收重点：与明细页汇总口径一致 · shared_type 复用 · 金额 cents
  │
  ├─ Sprint-Family-2：家庭页前端优先落地
  │   └─ COSTRA-223 · C5 家庭页全新开发
  │       单人引导态 · 多人协作态 · 成员横向滚动 · 已退出灰化
  │       公共/个人拆解 · 垫付贡献 · 与明细页联动
  │       设计约束：暖灰白 · 油墨黑 · 克制卡片 · 不做复杂趋势图
  │
  ├─ Sprint-Stats：统计页
  │   ├─ COSTRA-224 · D1 月度/年度统计报表 API
  │   └─ COSTRA-225 · C4 统计页全新开发
  │
  ├─ Sprint-Mine：我的页
  │   └─ COSTRA-226 · C6 我的页重做
  │
  └─ Sprint-Cleanup：联调与清理
      ├─ E1 前后端联调
      └─ E2 旧页面/旧逻辑清理
```

### 10.3 风险点

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 微信审核隐私合规 | 中 | 阻塞发布 | 提前准备隐私协议 + getPrivacySetting 检查 |
| 家庭邀请流程安全 | 中 | 越权/滥用 | D2 API 严格权限守门 + invite 过期机制 |
| 真机 safe-area 差异 | 低 | UI 错位 | safeArea.ts 统一 + 真机矩阵覆盖 |
| DB clean rebuild 数据丢失 | 高（开发期可接受） | 测试数据清空 | 开发期策略 · 不做历史兼容 |
| OpenAPI 契约漂移 | 中 | 前后端不一致 | D2 实装时补齐 x-deferred + 规则 E 自动检测 |

---

## §11 验收签字单

### 功能签字

| 功能域 | 验收人 | 日期 | 结果 | 备注 |
|--------|--------|------|------|------|
| Auth + Family Bootstrap | | | ☐ PASS / ☐ FAIL | |
| Categories API + 前端分类 | | | ☐ PASS / ☐ FAIL | |
| Entries + shared_type | | | ☐ PASS / ☐ FAIL | |
| Sync push/pull | | | ☐ PASS / ☐ FAIL | |
| 登录全链路 | | | ☐ PASS / ☐ FAIL | |
| 记账 overlay | | | ☐ PASS / ☐ FAIL | |
| 明细页 | | | ☐ PASS / ☐ FAIL | |
| 离线/同步 | | | ☐ PASS / ☐ FAIL | |

### 性能签字

| 指标 | 阈值 | 实测 | 结果 |
|------|------|------|------|
| 冷启到首页可见 | ≤ 3s | | ☐ |
| sync/pull 首次 | ≤ 2s | | ☐ |
| 记账保存到 overlay 关闭 | ≤ 500ms | | ☐ |

### 安全签字

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 跨 family 守门 | ☐ | |
| JWT 鉴权 | ☐ | |
| Idempotency-Key | ☐ | |
| personal family 不可删 | ☐ | |

### 兼容性签字

| 机型 | 结果 | 备注 |
|------|------|------|
| iPhone 15 Pro (iOS 17) | ☐ | |
| iPhone 13 (iOS 16) | ☐ | |
| Xiaomi 14 (Android 14) | ☐ | |
| Huawei P60 (Android 13) | ☐ | |

### 微信审核自查签字

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 隐私接口调用位置明确 | ☐ | |
| 授权弹窗规范 | ☐ | |
| getPrivacySetting 返回一致 | ☐ | |
| tabBar 规约遵守 | ☐ | |
| 分享卡片规范 | ☐ | |

---

**文档结束 · qa-planner · 2026-06-01（基于项目状态记录截至 COSTRA-220） · state.md 已更新 · history 已落盘**
