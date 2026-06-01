# COSTRA-218 · 后端分类 API (Backend Categories API)

> **Owner**: backend-dev · **Est**: 3pt · **Dep**: COSTRA-217 (B1/B2 ✅) · **Sprint**: Data-Layer Phase-B
> **状态**: Todo → Doing

---

## §A 背景

B1（migration 0008 二级分类 schema + seed 73 条）和 B2（entries.shared_type）已在 commit `c517c7a` 完成。

现在需要实现 `GET /v1/categories` 和 `POST /v1/categories` 两个端点，将 DB 中的分类数据通过 REST API 暴露给客户端。

OpenAPI 契约已在 `server/api/openapi.yaml` 中定义，本卡是契约的真实实装。

---

## §B 事实源

- **OpenAPI 契约**: `server/api/openapi.yaml` → `GET /categories` + `POST /categories` + `Category` schema
- **DB Schema**: `server/db/migrations/0008_categories_hierarchy_seed.sql`
- **设计字典**: `design/ui/category_dictionary.md`（73 条系统分类 + 去重映射规则）
- **参考实现**: `server/src/routes/entries.ts`（路由注册范式）/ `server/src/repositories/entryRepo.ts`（DAO 范式）/ `server/src/services/entryService.ts`（服务层范式）

---

## §C DoD (Definition of Done)

### C1: `server/src/repositories/categoryRepo.ts` — 新建

- [ ] 定义 `CategoryEntity` 接口：id, familyId(nullable), name, type, icon, color, sortOrder, isSystem, parentId(nullable), isDirectDefault, createdAt, updatedAt
- [ ] 定义 `CategoryRow` 内部接口（snake_case → camelCase 转换）
- [ ] `findByFamily(familyId: string | null): Promise<CategoryEntity[]>` — 查询系统分类(family_id IS NULL) + 指定家庭自定义分类(family_id = $1)，按 sort_order ASC 排序
- [ ] `findById(categoryId: string): Promise<CategoryEntity | null>`
- [ ] `insert(input: CreateCategoryInput): Promise<CategoryEntity>` — 插入自定义分类
- [ ] `countChildren(parentId: string): Promise<number>` — 计算子分类数量（供 API 响应的 children_count 字段）
- [ ] 遵循 `entryRepo.ts` 的 Runner 模式（支持 Pool / PoolClient 事务注入）

### C2: `server/src/services/categoryService.ts` — 新建

- [ ] `listCategories(familyId: string): Promise<CategoryTreeResponse>` 核心逻辑：
  1. 调 `categoryRepo.findByFamily(null)` 获取系统分类 + `categoryRepo.findByFamily(familyId)` 获取家庭自定义分类
  2. 合并后组装为树形结构（parent_id=null 为一级，其余为二级挂在对应 parent 下）
  3. 每个分类附加 `children_count` 字段（基于内存计算，不需额外查询）
  4. 返回平铺数组（由客户端组装树，也可直接返回嵌套树 — 按 OpenAPI 契约：返回平铺 `Category[]`，客户端通过 parent_id 自行组装）
- [ ] `createCategory(familyId: string, input: CreateCategoryInput): Promise<CategoryEntity>` 核心逻辑：
  1. 校验 parent_id 存在且 parent 层级 = 一级（不允许三层）
  2. 校验 family_id 有效（通过 familyRepo）
  3. 校验同名同类型同 parent 下不重复（UNIQUE 约束也会兜底）
  4. 调 `categoryRepo.insert()`
- [ ] 权限校验：确认 userId 属于 familyId（通过 familyRepo.isUserInFamily）

### C3: `server/src/routes/categories.ts` — 新建

- [ ] `GET /categories` 路由：
  - Query schema: `{ family_id: { type: 'string', format: 'uuid', required: true } }`
  - JWT 校验（复用 entries.ts 的 parseUserId 模式，或抽为公共 helper）
  - 权限守门：userId 必须属于 family_id 指定的家庭
  - 响应 200: `Category[]` 数组（平铺，含 children_count）
- [ ] `POST /categories` 路由：
  - Header: `Idempotency-Key`（可选，MVP 阶段不强制）
  - Body schema: `CategoryCreate`（family_id, name, type, icon, color?, parent_id?）
  - JWT 校验 + 权限守门
  - 响应 201: `Category`
- [ ] 注册函数 `registerCategoriesRoutes(app: FastifyInstance): Promise<void>`

### C4: `server/src/app.ts` — 修改

- [ ] import `registerCategoriesRoutes` from `./routes/categories.js`
- [ ] 在 `/v1` prefix 子作用域内注册：`await registerCategoriesRoutes(v1);`

### C5: 单测 `server/test/categories.test.ts` — 新建

- [ ] T1: GET /v1/categories 无 token → 401
- [ ] T2: GET /v1/categories 无 family_id → 400
- [ ] T3: GET /v1/categories 正常 → 200 + 返回 73 条系统分类（含 children_count）
- [ ] T4: GET /v1/categories 非成员 family_id → 403 FORBIDDEN
- [ ] T5: POST /v1/categories 创建自定义分类 → 201
- [ ] T6: POST /v1/categories parent_id 指向二级分类 → 400（不允许三层）
- [ ] T7: POST /v1/categories 重复名 → 409 或 DB 约束错误映射
- [ ] T8: 验证 children_count 正确（一级分类的 children_count = 其下二级数量）

### C6: 闸门通过

- [ ] `npm run typecheck` 全绿
- [ ] `npm run test` 全绿（含新增 T1~T8 + 既有 100 测不回归）
- [ ] 无 lint error

---

## §D 可写范围

```
server/src/repositories/categoryRepo.ts    — 新建
server/src/services/categoryService.ts     — 新建
server/src/routes/categories.ts            — 新建
server/src/app.ts                          — 修改（仅添加 import + 注册行）
server/test/categories.test.ts             — 新建
.team/members/backend-dev/state.md         — 更新
.team/members/backend-dev/history/         — 新增交付记录
```

**禁写**：`miniprogram/` / `design/` / `api/openapi.yaml`（API 契约已定义不改）/ DB migration（B1 已完成）

---

## §E 技术约束

1. **遵循 entries.ts 路由代码风格**：路由层只做 HTTP 参数解析/响应装配，业务逻辑交给 service
2. **遵循 entryRepo.ts DAO 风格**：Runner 模式 + rowToEntity 转换 + 参数化查询
3. **不引入新依赖**
4. **GET /categories 响应格式**：平铺 `Category[]`（含 parent_id + children_count），不做嵌套树包装
5. **系统分类 family_id = NULL**：查询时用 `family_id IS NULL OR family_id = $1` 合并返回
6. **children_count 应用层计算**：从查询结果中按 parent_id 分组 COUNT，不需 sub-query

---

## §F 强制阅读清单

1. `server/api/openapi.yaml` — Category/CategoryCreate schema 定义
2. `server/db/migrations/0008_categories_hierarchy_seed.sql` — 表结构 + 约束 + seed 数据
3. `server/src/routes/entries.ts` — 路由注册范式参考
4. `server/src/repositories/entryRepo.ts` — DAO 范式参考
5. `server/src/services/entryService.ts` — 服务层范式参考
6. `server/src/repositories/familyRepo.ts` — isUserInFamily 权限校验参考
7. `design/ui/category_dictionary.md` — 分类数据字典

---

## §G 时间预算

| 阶段 | 预估 |
|------|------|
| 阅读参考代码 | 10 min |
| categoryRepo.ts | 15 min |
| categoryService.ts | 15 min |
| routes/categories.ts | 10 min |
| app.ts 注册 | 2 min |
| 单测 T1~T8 | 20 min |
| 闸门验证 + 修复 | 10 min |
| state.md 更新 | 5 min |
| **合计** | **~87 min** |

---

## §H 验收标准

1. `npm run typecheck` PASS
2. `npm run test` PASS（全部测试含新增，0 fail）
3. GET /v1/categories?family_id=xxx 返回正确的 73 条系统分类 + children_count
4. POST /v1/categories 可创建自定义分类，约束正确拦截非法输入
5. 权限守门正确（非成员 403）
6. 代码风格与 entries 路由一致
