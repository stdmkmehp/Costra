# COSTRA-218 R1 · 后端分类 API 实装

> 卡号：COSTRA-218 · 角色：backend-dev · 日期：2026-06-09 · 状态：R1 完成

---

## §1 产出摘要

实装 `GET /v1/categories` 和 `POST /v1/categories` 两个端点，将 DB 中已 seed 的分类数据通过 REST API 暴露给客户端。

### 新增文件（4）

| 文件 | 说明 |
|------|------|
| `server/src/repositories/categoryRepo.ts` | CategoryEntity + CategoryRow + rowToEntity + findByFamily + findById + insert（Runner 模式） |
| `server/src/services/categoryService.ts` | listCategories（权限守门 + children_count 计算）+ createCategory（权限守门 + 层级校验 + 同名去重） |
| `server/src/routes/categories.ts` | GET /categories + POST /categories + JWT 校验 + schema 校验 + registerCategoriesRoutes 导出 |
| `server/test/categories.test.ts` | T1~T8 单测（8 条） |

### 修改文件（1）

| 文件 | 变更 |
|------|------|
| `server/src/app.ts` | +import registerCategoriesRoutes + 注册到 /v1 prefix 子作用域 |

---

## §2 关键设计决策

1. **权限守门**：listCategories / createCategory 均通过 `isUserInFamily(userId, familyId)` 校验，非成员返回 403 FAMILY_NOT_MEMBER
2. **children_count 应用层计算**：`findByFamily` 返回全量后，内存按 parent_id 分组 COUNT；一级分类 children_count = 其下二级数，二级分类 = 0
3. **同名去重双保险**：应用层先查 `findByFamily` 做内存判重 + DB `uq_categories_family_name_type_parent` UNIQUE 约束兜底（pg-mem 不支持含 COALESCE 的唯一索引，应用层校验确保测试覆盖）
4. **层级校验**：createCategory 若 parent_id 指向二级分类（其 parentId !== null），抛 422 BUSINESS_RULE_VIOLATION
5. **平铺响应**：GET /categories 返回 Category[]（含 parent_id + children_count），不嵌套树

---

## §3 闸门结果

| 闸门 | 结果 |
|------|------|
| `npm run typecheck` | ✅ PASS |
| `npm run test` | ✅ 108/108 PASS（含新增 T1~T8 + 0 回归）|
| lint | ✅ stub exit 0 |

---

## §4 遗留

- P1: 无
- P2: `isUserInFamily` 与 syncPullService 重复 · 待 FU-154-FAMILY-MEMBER-REPO 统一抽公共函数
- P2: pg-mem 不支持 COALESCE 在唯一索引中 · 应用层同名去重已在 service 层补充 · 真实 PG 行为仍由 DB 约束兜底

---

## §5 自检清单

- [x] state.md 已更新（§2 当前关注 + §3 交付历史 + §7 时间戳）
- [x] history 已落盘
- [x] 新接口遵循 OpenAPI 契约（未改 openapi.yaml）
- [x] 查询带 family_id 过滤（findByFamily: `family_id IS NULL OR family_id = $1`）
- [x] 无金额字段（本卡不涉及）
- [x] 日志无敏感字段泄漏
- [x] 无 AppID / 域名硬编码
- [x] 无 DB 变更（migration 和 schema.md 未动）
- [x] 单测覆盖 T1~T8（8/8 PASS）
- [x] commit scope 待落盘（未 commit · 等 Orchestrator 安排）
