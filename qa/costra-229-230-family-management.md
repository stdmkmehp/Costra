# COSTRA-229 + COSTRA-230 · 家庭离开/解散/重命名 联合实测手册

> **事实源**: `.team/decisions/D-029-family-leave-ownership-transfer.md`
> **范围**:
> - COSTRA-229 后端: `POST /v1/families/{id}/members/me/leave` + `deleteFamily` 单事务化
> - COSTRA-230 前端: 自己头像 ActionSheet + 重命名账本入口
> **预计时间**: ~15 分钟（人工真机）

---

## §1 前置

```bash
# 后端
cd server && npx vitest run        # 期望: 15 files / 148 tests passed
cd .. && npx tsc --noEmit          # 期望: 零错误

# Commit 锚点
git log --oneline -2
# 期望:
#   b46d4fc feat(miniapp): costra-230 family management actionsheet + rename overlay
#   88873f3 feat(backend): costra-229 family leave/dissolve with ownership transfer
```

---

## §2 后端单测验收（COSTRA-229）

```bash
cd server && npx vitest run test/families.test.ts
```

期望输出最后一行：`Tests  23 passed (23)`，新增覆盖：

| 用例 | 不变量 |
|---|---|
| T17 | 非 owner leave → 204，member status=left |
| T18 | owner 多人 leave → 所有权转给 joined_at ASC 最早成员 |
| T19 | owner 单人 leave → family 自动 softDelete |
| T20 | personal family leave → 403 FAMILY_PERSONAL_NOT_DELETABLE |
| T21 | 已 left 成员重复 leave → 403 FAMILY_NOT_MEMBER（幂等） |
| T22 | DELETE family 后所有 active 成员 left_at + color_slot=NULL |

---

## §3 前端真机实测（COSTRA-230）

### §3.1 自己头像 ActionSheet（B1：非 owner）

**前置**：用户 A 是某 shared family 的 owner，邀请用户 B 加入。

| 步骤 | 操作（B 视角） | 期望 |
|---|---|---|
| 1 | 点击家庭页底部"我"卡片头像 | 弹出 ActionSheet["离开家庭"]（红色） |
| 2 | 点击"离开家庭" | wx.showModal "离开后将无法再访问该账本数据，确认离开？" |
| 3 | 点击确定 | toast"已离开" → 页面切回 personal 账本 |
| 4 | A 视角刷新家庭页 | B 在成员列表中 status=left（灰色） |

### §3.2 自己头像 ActionSheet（B2：owner 多人）

**前置**：A=owner，B 已加入，C 已加入（顺序 B 早于 C）。

| 步骤 | 操作（A 视角） | 期望 |
|---|---|---|
| 1 | 点击 A 自己头像 | ActionSheet["离开家庭"] |
| 2 | 点击"离开家庭" | Modal "离开后管理员身份会自动移交给最早加入的成员，确认离开？" |
| 3 | 确定 | toast"已离开" → A 切回 personal |
| 4 | B 视角刷新家庭页 | B 头像变为 owner（带★或 owner 角标），C 仍是 member，A=left |

### §3.3 自己头像 ActionSheet（B3：owner 单人 / 解散）

**前置**：A 创建 shared family 但无成员加入。

| 步骤 | 期望 |
|---|---|
| 点击 A 自己头像 | ActionSheet["解散账本"] （注意文案差异） |
| 点击 → Modal | "解散后账本及所有数据将无法恢复，确认解散？" |
| 确定 | toast"已解散" → 切回 personal；A 在"账本切换"中不再看到该账本 |

### §3.4 personal family 自己头像

**前置**：personal family 中只有 owner。

| 期望 |
|---|
| 点击自己头像 → ActionSheet["解散账本"] → 确定 → 弹 toast"账本不可解散"（来自后端 FAMILY_PERSONAL_NOT_DELETABLE 错误码 mapped desc） |

> 备注：客户端不主动屏蔽 personal 解散按钮（保持 UI 一致性），由后端统一 reject。

### §3.5 重命名账本（B4：owner）

**前置**：A 是 shared family owner。

| 步骤 | 操作 | 期望 |
|---|---|---|
| 1 | 点击导航栏标题（家庭名+▼） | ActionSheet 末尾出现"重命名当前账本" |
| 2 | 点击"重命名当前账本" | 弹出"重命名账本"弹窗，badge 字"名"，输入框预填当前名称，placeholder"输入账本名称（最多 20 字）" |
| 3 | 视觉对齐校验 | 与"创建协作账本"弹窗 1:1 一致：mask 压暗、card 圆角、badge 圆形蓝、按钮配色与排布 |
| 4 | 不改名直接点保存 | 弹窗静默关闭（不触发版本递增） |
| 5 | 改名为新名称 → 保存 | 按钮 loading 转圈 → 关弹窗 → toast"已修改" → 标题更新为新名称 |
| 6 | 进入明细页 / 统计页 | 标题同步更新为新名称（缓存已失效） |

### §3.6 重命名 personal family（B5）

| 期望 |
|---|
| personal family 也支持重命名（与解散语义不同），步骤同 §3.5 |

### §3.7 非 owner 不可重命名

**前置**：B 是某 shared family 的 member。

| 期望 |
|---|
| B 点击导航栏切换 ActionSheet 中**不出现**"重命名当前账本"项 |

---

## §4 端到端联调验收

| 场景 | 期望 |
|---|---|
| E1 owner 重命名后退出 family | 切回 personal,新 owner 看到的标题是改后的名 |
| E2 owner 单人 leave 后再次创建同名 shared family | 成功（旧家庭已 softDelete,unique 约束按 deleted_at IS NULL 过滤） |
| E3 离开后查看明细历史月份 | 不可达（403 FAMILY_NOT_MEMBER），自动回 personal |
| E4 多端同步：A leave，B 端打开家庭页 | B 看到 A status=left；A 端的 family_list 不再包含该 family |

---

## §5 PASS 判据

| 编号 | 通过条件 |
|---|---|
| P1 | §2 vitest 全绿 23 个 family 用例 |
| P2 | §3.1 ~ §3.7 全部按表期望 |
| P3 | §3.5 重命名弹窗视觉与"创建协作账本"完全一致（截图对比） |
| P4 | §4 E1~E4 端到端流通 |
| P5 | 控制台无任何 [family] xxx failed 报错（除已 mapped 错误码） |
