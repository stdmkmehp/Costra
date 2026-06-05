# D-029 · 家庭离开 / 解散 / 所有权移交语义

> **日期**：2026-06-05
> **发起人**：Human
> **登记人**：Orchestrator（main 落地路径）
> **状态**：Approved
> **关联**：COSTRA-229（后端 leave/dissolve）/ COSTRA-230（前端 ActionSheet + 重命名）/ ADR-0007（家庭-账本关系模型）/ migration 0001 family_members.left_at / migration 0007 families.kind

---

## §1 背景

家庭管理至 Sprint-3 末为止存在功能缺口：

1. 仅有 `DELETE /families/{id}/members/{user_id}`（owner 移出他人）与 `DELETE /families/{id}`（owner 解散），**无成员主动离开端点**
2. 当 owner 主动离开 shared family 时缺少「自动移交所有权」语义，导致家庭进入「无 owner 但仍 active」的中间态
3. 当 owner 离开仅剩自己一人的 shared family 时，缺少「自动解散」语义，留下空 family
4. 解散 family 时 `softDelete` 仅写 `deleted_at`，未同步 `family_members.left_at`，导致 active member 视图与 family 软删状态不一致
5. 前端无任何 UI 入口让成员主动离开 / 让 owner 在保留家庭前提下转交管理权

---

## §2 决策

### §2.1 离开端点

新增 `POST /v1/families/{family_id}/members/me/leave` → 204，业务编排在 `familyService.leaveFamily(userId, familyId)`：

| 角色 | 成员状态 | 行为（单事务） |
|---|---|---|
| 非 owner | 任意 | `setLeftAt(self)` |
| owner | 多人 active | `findNextOwnerCandidate` + `transferOwnership` + `setLeftAt(self)` |
| owner | 仅自己一人 | `setAllActiveLeftAt(family)` + `softDelete(family)` + `setLeftAt(self)` 已在前一步覆盖 |
| 任意 | personal family | 抛 `FAMILY_PERSONAL_NOT_DELETABLE`（403） |

### §2.2 移交规则

`findNextOwnerCandidate(familyId, excludeUserId=self)` 用 SQL 直接选：

```sql
SELECT user_id FROM family_members
 WHERE family_id = $1 AND user_id != $2 AND left_at IS NULL
 ORDER BY joined_at ASC
 LIMIT 1
```

- **不读全量列表后再 JS 排序**（用户偏好「不写硬逻辑」）
- 同事务内同时 `SET role='member'` 旧 owner、`SET role='owner'` 新 owner
- 同时事务保证：并发两人 leave 时只有一人能成功完成移交链

### §2.3 解散语义增强

`familyService.deleteFamily` 改造：在 `withTx` 单事务内先 `setAllActiveLeftAt(family)`（批量 `UPDATE family_members SET left_at=now() WHERE family_id=$1 AND left_at IS NULL`）再 `familyRepo.softDelete(family)`。这样保证：

- 解散后所有成员立即从 active member 集合中剔除
- `listActiveFamiliesByUser` 不再返回该 family
- `getFamilyDetail` 走 `assertActiveMember` 直接 403

### §2.4 错误码复用

不引入新错误码：

- personal family 拒绝 → 沿用 `FAMILY_PERSONAL_NOT_DELETABLE`（避免 ErrorCode 表膨胀）
- 重复 leave（已 left）→ `setLeftAt` 命中 0 行抛 `NOT_FOUND`，由 `assertActiveMember` 在 service 入口提前拦截，文案统一
- 仅剩一人时 leave **不抛错**，是合法的「自动解散」分支（不构造 `FAMILY_TRANSFER_NO_CANDIDATE`）

### §2.5 历史记录处理

「成员离开 family」≠「删除该成员的历史 entries」：

- entries 不删不改，对其余 active 成员仍可见
- 离开成员自身因 `assertActiveMember` 失败而不可读写该 family
- 这是「软删 + 视图过滤」语义，不是「物理删除 + 级联」

---

## §3 前端 UX 决策（COSTRA-230）

### §3.1 ActionSheet 三分支

| 点击对象 | 当前用户 | ActionSheet 项 |
|---|---|---|
| 自己头像 | 普通成员 | 「离开协作」 |
| 自己头像 | 管理者 | 「账本重命名 / 离开协作 / 解散协作家庭」 |
| 他人头像 | 管理者 | 「移出协作」 |
| 他人头像 / 自己头像 | left 成员 / 非管理者点他人 | 无响应 |

### §3.2 二次确认文案

| 场景 | 文案 |
|---|---|
| 踢出 | `确定将{name}移出协作？` |
| 成员主动离开 | `确定离开{familyName}吗？离开后将无法查看协作记录。` |
| 管理者离开（有继承人） | `你是管理者。离开后管理权限将自动移交给{nextOwnerName}。确定离开？` |
| 管理者离开（仅剩一人） | `你是最后一位成员，离开后协作账本将自动解散。确定离开？` |
| 解散 | `解散后所有成员将被移出协作。历史记录保留但不可再写入。确定解散{familyName}？` |

### §3.3 离开 / 解散后的统一收尾

`_fallbackToPersonalAndExit()`：

1. `getFamilies()` 找 `kind === 'personal'` 的（bootstrap 保证一定存在）
2. `setActiveFamily({ family_id, ledger_id, family_kind:'personal', ledger_name })`
3. `savePreferenceAsync(personalId, personalLedgerId)`
4. `wx.switchTab({ url: '/pages/ledger/index' })` —— 目标页 `onShow` 通过 `getActiveFamilyId/Ledger*` 自然读到新 active

**不 emit 任何事件**：项目现有「账本切换」模式就是「写本地 active + switchTab → 目标页 onShow 重读」。`LEDGER_SWITCHED` 事件不存在，不为本次新增（避免引入冗余事件，与 `onTapFamilyName` 的多家庭切换路径完全镜像）。

### §3.4 重命名 overlay 视觉规范

1:1 复用 `styles/invite-dialog.wxss` 的现有 token：

- `invite-dialog__mask`（半透明压暗 + blur）
- `invite-dialog__card`（圆角白卡 + 阴影）
- `invite-dialog__badge`（圆形徽标，重命名用「名」字）
- `invite-dialog__title` / `invite-dialog__desc`
- `invite-dialog__actions` 双按钮（左次按钮 / 右主按钮）
- `create-family__input` / `create-family__input-placeholder` / `create-family__error`

**零新增样式类名**（plan 七已审计：前端无任何 rename 老入口，纯新增）。

### §3.5 老入口审计

全仓搜索 `重命名 / rename / renameFamily / updateFamily / PATCH families` 等关键词：

- `miniprogram/services/familyApi.ts` 无 PATCH 调用
- `miniprogram/pages/family/index.{ts,wxml,wxss}` 无 rename 入口
- `miniprogram/pages/mine/*` 无 rename 入口

→ 本次为**纯新增功能**，无老逻辑需删除，不存在新旧入口冗余。

---

## §4 数据语义不变量（写入测试断言）

1. personal family 永远不允许进入 `setLeftAt` / `softDelete`（被 `kind === 'personal'` 守门）
2. leave / dissolve / removeMember 完成后，`family_members.left_at IS NOT NULL` 的记录**不允许回滚**（除非通过 `acceptInvite` 重新加入，已有 `ON CONFLICT DO UPDATE` 处理）
3. 历史 entries 不删不改（「成员离开」≠「删除其记录」）
4. owner 移交 + `setLeftAt(self)` **必须在同一事务**（不允许「角色改了但 left_at 没写」中间态）
5. dissolve 必须在同一事务内先 `setAllActiveLeftAt` 再 `softDelete`（不允许「family 已软删但成员仍 active」中间态）

---

## §5 影响面

| 文件 | 类型 | 说明 |
|---|---|---|
| `server/api/openapi.yaml` | MODIFY | paths 节追加 `/families/{family_id}/members/me/leave` POST 定义 |
| `server/src/repositories/familyMemberRepo.ts` | MODIFY | 新增 `findNextOwnerCandidate` / `transferOwnership` / `setAllActiveLeftAt` 三 DAO；现有 `setLeftAt` 不动 |
| `server/src/services/familyService.ts` | MODIFY | 新增 `leaveFamily`；`deleteFamily` 改造为单事务先 `setAllActiveLeftAt` 再 `softDelete` |
| `server/src/routes/families.ts` | MODIFY | 注册 `POST /families/:family_id/members/me/leave` |
| `server/test/families.test.ts` | MODIFY | 追加 leave / dissolve 5 + 1 测试用例（5 分支 + 幂等） |
| `miniprogram/services/familyApi.ts` | MODIFY | 新增 `leaveFamily(familyId)` / `renameFamily(familyId, name, version)` |
| `miniprogram/pages/family/index.ts` | MODIFY | `onTapMember` 三分支重写；新增 4 confirm 方法 + rename overlay data/handlers |
| `miniprogram/pages/family/index.wxml` | MODIFY | 新增 rename overlay 节点（视觉 1:1 对齐 createOverlay） |
| `qa/costra-229-230-family-management.md` | NEW | 联合测试手册 |
| `.codebuddy/memory/2026-06-05.md` | MODIFY | 落地结论 + 关键不变量 |

---

## §6 拒绝的备选方案

| 方案 | 拒绝理由 |
|---|---|
| 移交规则用「按 role 优先级 + joined_at」 | 当前仅 owner / member / viewer 三角色，role 在剔除 owner 后无歧义；多排序键徒增复杂度。`joined_at ASC` 简单、可解释、O(1) 索引扫描。 |
| 仅剩一人 leave 抛 `FAMILY_TRANSFER_NO_CANDIDATE` | 这是合法状态而非错误。强制错误会让用户「无法离开」，违反产品语义。 |
| 离开后 emit `LEDGER_SWITCHED` 事件刷新订阅页 | 项目现有账本切换模式就是「写本地 + switchTab + onShow 重读」，不存在该事件。引入新事件 = 冗余且与 `onTapFamilyName` 路径不一致。 |
| 重命名 overlay 自起一套样式 | `styles/invite-dialog.wxss` 已有完整 token，自起样式 = 视觉漂移 + 维护成本翻倍。 |
| `removeMember` 路径同步 emit 事件强迫被踢者切 tab | 被踢者**自己端**无网络通道感知此事件（除非长连），下次 onShow 由 `assertActiveMember` 失败 → bootstrap fallback 兜底已足够。 |

---

## §7 验收

- ✅ 5 个后端测试用例全绿（非 owner leave / owner 多人移交 / owner 单人解散 / personal 拒绝 / 重复 leave 幂等）
- ✅ `server/test/families.test.ts` 解散流程断言：所有 active member `left_at` 已写
- ✅ 前端 typecheck 零错误
- ✅ 联合 QA 手册（5 后端 + 7 前端 + 4 端到端）人工测试通过
- ✅ rename overlay 视觉与 createOverlay 像素对齐（人工 review）

---

**修订**：

- 2026-06-05 v1.0 · Approved（main 落地路径，无 dispatch 双 review；plan 已经过 ready 闸门 + Human 审过视觉/老入口约束）
