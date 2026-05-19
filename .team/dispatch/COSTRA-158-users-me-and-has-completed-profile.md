# COSTRA-158 · /users/me 完整实装 + has_completed_profile 严格资料判定

> **派单时间**：2026-05-19 09:44（Orchestrator · Human `D-recommended` 决策后同轮落盘）
> **触发**：COSTRA-157 R1 APPROVE 后 Human 反对 hasProfile 概率近似判定 · 调研发现 PATCH /users/me 在 OpenAPI 已定义但 server 从未实装（COSTRA-101 遗留 gap）· Human 选方案 D（5 点单卡）
> **依赖**：COSTRA-101（authService.toUserView 现状 · CLOSED）· COSTRA-104（entryService optimisticUpdate 范式可参考 · CLOSED）· COSTRA-156（v1 prefix · users 路由必须挂 v1 子作用域 · CLOSED）· COSTRA-157（hasProfile 字段已布桩 · CLOSED）
> **下游解锁**：FU-COMMON-MINIAPP-PATCH-LIMIT 真闭合（server PATCH 路由真实存在）· COSTRA-401 Epic-F 月度报表（用户资料完整度统计）· Sprint-3 Epic-D 完善资料页（直接消费 has_completed_profile）

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1**（D-014-a · 同轮）| `costra-card-reviewer-tech`（D-022 v2.0 评分参考 · 但本轮仍走 SOP-CARD-REVIEW 30 分制） | 等 Orchestrator 同轮 spawn |
| **R1 实装** | `costra-backend-dev`（主驾 · 8 项 server 改动）+ `costra-miniapp-dev`（协作 · 3 项 client 改动）· 单卡双装扮档 | 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-014-b 自动拉起 · D-022 v2.0 第 6 次实战）| 等 R1 实装完 |
| **Human T1 终审** | `approve:COSTRA-158` | 等 R1 Review APPROVE |

---

## §1 背景

### 1.1 触发链（三段）

**段 1 · COSTRA-101 遗留 gap**：
- COSTRA-020 G3（OpenAPI 契约 30/30 通过 · 2026-04-21）即定义 `/users/me` GET + PATCH
- COSTRA-101 R1 实装（2026-04-24）只交付 `/auth/wx-login` `/auth/refresh` `/auth/logout` 三端点
- `/users/me` GET / PATCH **从未实装** · 但当时 scope 边界合理（COSTRA-101 是登录卡 · 不是用户画像卡）· 只是后续没专项卡兜

**段 2 · 漏检与误归因**：
- COSTRA-118 技术债普查（2026-04-24）未发现该 gap
- COSTRA-102 client 端 `login/index.ts:71-83` 调 PATCH /users/me（COSTRA-102 R1 实装 2026-04-27）· 兜底 catch warn 吞错
- 2026-05-01 COSTRA-123 收官时 Human 第 6 次模拟器启动 · console 看到 `404 + route not found: POST /v1/users/me` · 立 FU-COMMON-MINIAPP-PATCH-LIMIT · **误归因**为"wx.request 不支持 PATCH 走 X-HTTP-Method-Override 降级 · server 不识别该 header"——实际真相是 server 路由根本不存在 · 即便 client 用真 PATCH 也会 404

**段 3 · COSTRA-157 hasProfile 边界争议触发暴露**：
- COSTRA-157 R1 APPROVE 38/40（2026-05-18 19:1x）· dispatch §2.1 E 用 `u.nickname !== defaultNickname` 间接判定 hasProfile · 接受"用户真名='微信用户'撞库"的极低概率边界
- 2026-05-19 09:42 Human 反对："不能假设概率极低就不处理 · 要严格准确"
- 2026-05-19 09:44 调研后发现段 1+2 真相 · Human 选方案 D（单卡 5 点完整修复）

### 1.2 PRD / 契约锚点

- **OpenAPI 契约**：`server/api/openapi.yaml:127-158`（GET + PATCH /users/me · User schema 现有 5 字段 · 本卡新增 `has_completed_profile`）
- **error-codes.md §0.5**：客户端不直出 server message（COSTRA-157 已守 · 本卡保持）
- **D-008 主体策略**：不引入主体字样硬编码（has_completed_profile 是中性字段 · 与主体无关）
- **PRD（无直接 AC）**：用户资料补全是 Epic-A 隐式语义（首登 → 拒绝/同意授权 → 资料完整性指示器）

### 1.3 Human 2026-05-19 09:44 决策

`D-recommended`：
- **D**：单卡 5 点 · Sprint-2 内做 · 11 项 scope（DB + server + miniapp 全栈）
- **同时关 FU-COMMON-MINIAPP-PATCH-LIMIT**：server PATCH 路由实装后 · client 现有降级链路（POST + X-HTTP-Method-Override）实质失效 · 本卡顺手把这条降级链路也清掉（client request.ts 不再特殊处理 PATCH · 直接走 wx.request 不支持 PATCH 的真现实 · 改用统一 POST + Method-Override · server 加 method override middleware 兼容）

> **特别说明**：Q3-A 在 COSTRA-157 时是"留 COSTRA-152 顺手做"· 本卡覆写为"COSTRA-158 顺手做" · 因为 COSTRA-158 实装 server users.ts 时正好需要决策 PATCH 落地方式 · 顺势统一处理 · 不再延后

---

## §2 Scope（11 项 · 估点 5 · INVEST small 上限内）

### 2.1 主交付（11 项 · 必交）

#### A · DB migration（新建文件 · 1 项）

**`server/db/migrations/0005_users_has_completed_profile.sql`**：

```sql
-- =========================================================================
-- COSTRA-158 · users.has_completed_profile 列
-- Owner: Backend-Agent · 日期: 2026-05-19
-- 来源：COSTRA-157 hasProfile 严格判定争议 · Human 决策方案 D
-- =========================================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN has_completed_profile BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.has_completed_profile IS
'COSTRA-158: 用户是否完成资料补全（首登默认 FALSE · PATCH /users/me 成功后 TRUE）。'
'用于客户端 home 页"完善资料"入口的严格判定（替代 nickname 字符串比较代理判定）。'
'语义稳定字段：升级 default nickname 不影响判定 / 用户改名为占位串不误判 / 多端同账号一致。';

-- 不做 backfill（MVP < 10 用户 · 让用户重新点"完善资料"自然修复 · 同时验证新链路）

COMMIT;
```

#### B · userRepo 增 hasCompletedProfile 字段映射 + updateProfile 方法（修订 1 文件）

**`server/src/repositories/userRepo.ts`** 改动：

1. **`UserEntity` 接口加字段**（line 17~28 之间）：
   ```ts
   hasCompletedProfile: boolean;
   ```

2. **`UserRow` 接口加字段**（line 30~41 之间）：
   ```ts
   has_completed_profile: boolean;
   ```

3. **`rowToEntity` 加映射**（line 43~56）：
   ```ts
   hasCompletedProfile: r.has_completed_profile,
   ```

4. **`findByOpenid` / `findById` SELECT 加列**：
   ```sql
   SELECT id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
          has_completed_profile,
          created_at, updated_at, deleted_at, version
   ```

5. **`create` INSERT 不设 has_completed_profile**（依赖 DB DEFAULT FALSE · 显式不设保持简洁）· **RETURNING 加 has_completed_profile**

6. **新增 `updateProfile` 方法**（紧跟 upsertByOpenid 之后）：

   ```ts
   export interface UpdateProfileInput {
     nickname?: string;
     avatarUrl?: string | null;
     timezone?: string;
   }

   /**
    * 更新当前用户的画像信息（PATCH /users/me 路径消费）
    *
    * 行为约定：
    *   - 只更新传入的字段（部分更新语义 · COALESCE 兜底）
    *   - 任意字段更新成功后 has_completed_profile 设为 TRUE（语义：用户至少主动调过一次 PATCH）
    *   - version + 1（乐观锁支持 · 与 COSTRA-104 entryService 范式一致）
    *   - 软删用户（deleted_at IS NOT NULL）禁止更新
    *
    * 不做：
    *   - has_completed_profile 一旦 TRUE 不可降级回 FALSE（语义单调 · 简化判定）
    *   - 字段值校验由 service 层做（如 nickname 长度 · avatarUrl 格式）
    */
   export async function updateProfile(
     userId: string,
     input: UpdateProfileInput,
     client?: Runner,
   ): Promise<UserEntity | null> {
     const runner = client ?? exec();
     const res = await runner.query(
       `UPDATE users
           SET nickname = COALESCE($2, nickname),
               avatar_url = CASE WHEN $3::TEXT IS NULL AND $4::BOOLEAN THEN NULL
                                 ELSE COALESCE($3, avatar_url) END,
               timezone = COALESCE($5, timezone),
               has_completed_profile = TRUE,
               updated_at = now(),
               version = version + 1
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
                   has_completed_profile, created_at, updated_at, deleted_at, version`,
       [
         userId,
         input.nickname ?? null,
         input.avatarUrl ?? null,
         input.avatarUrl === null,  // 显式传 null = 想清空 avatar · 不是不更新
         input.timezone ?? null,
       ],
     );
     return res.rows[0] ? rowToEntity(res.rows[0]) : null;
   }
   ```

   > **特别说明**：avatar_url 三态语义（不传 = 不更新 / 传非空 = 更新 / 传 null = 清空）通过双参数 + CASE 表达式区分。

#### C · authService.toUserView 加 has_completed_profile 字段（修订 1 文件）

**`server/src/services/authService.ts`** 改动：

1. **`AuthTokenPair.user` 接口加字段**（line 42~49）：
   ```ts
   has_completed_profile: boolean;
   ```

2. **`toUserView` 入参类型加字段** + **返回值加映射**（line 72~88）：
   ```ts
   function toUserView(u: {
     id: string;
     nickname: string;
     avatarUrl: string | null;
     timezone: string;
     hasCompletedProfile: boolean;          // ← 新增
     createdAt: Date;
     updatedAt: Date;
   }): AuthTokenPair['user'] {
     return {
       id: u.id,
       nickname: u.nickname,
       avatar_url: u.avatarUrl,
       timezone: u.timezone,
       has_completed_profile: u.hasCompletedProfile,   // ← 新增
       created_at: u.createdAt.toISOString(),
       updated_at: u.updatedAt.toISOString(),
     };
   }
   ```

#### D · 新建 server/src/routes/users.ts（GET + PATCH /users/me 双 handler · 1 项 · 100~150 行）

**新建文件结构**：
- 模块导出 `registerUsersRoutes(app: FastifyInstance)`
- 路由注册到 v1 子作用域（`server/src/app.ts` 已有 prefix 容器 · 见 §2.1 G）
- GET /users/me：
  - 走 `app.requireAuth` middleware（如已存在）或 `verifyAccessToken` 自验证
  - 调 `userRepo.findById(claims.sub)` · 不存在 → 401（极端场景）
  - 返回 User schema（含 has_completed_profile · 注意字段顺序与 OpenAPI 一致）
- PATCH /users/me：
  - 同 auth middleware
  - body 校验：fastify schema validation（nickname maxLength 32 / avatar_url uri / timezone string）· 至少 1 字段非空（否则 400 INVALID_ARGUMENT）
  - 调 `userRepo.updateProfile(userId, body)` · null → 401
  - 返回 User schema
  - **副作用**：has_completed_profile 自动设为 true（在 updateProfile 内）
- 错误处理：用 `AppError` + `ErrorCode`（参考 auth.ts 范式）

> 实装时**参考** `server/src/routes/auth.ts` 的 fastify 路由风格、`server/src/routes/entries.ts` 的 schema validation 风格、`server/src/routes/healthz.ts` 的最简模板。

#### E · server/src/app.ts 注册 users 路由（修订 1 文件 · 2 行）

在 v1 子作用域内追加（紧跟 entries / sync 注册之后）：
```ts
await app.register(async (v1) => {
  await registerAuthRoutes(v1);
  await registerEntriesRoutes(v1);
  await registerSyncRoutes(v1);
  await registerUsersRoutes(v1);  // ← 新增（COSTRA-158）
}, { prefix: '/v1' });
```

import 段加：
```ts
import { registerUsersRoutes } from './routes/users.js';
```

#### F · OpenAPI User schema 加 has_completed_profile 字段（修订 1 文件 · 1 行）

**`server/api/openapi.yaml` line 875~884** User schema：

```yaml
User:
  type: object
  required: [id, nickname, has_completed_profile, created_at]   # ← 加到 required
  properties:
    id: { type: string, format: uuid }
    nickname: { type: string }
    avatar_url: { type: string, format: uri, nullable: true }
    timezone: { type: string, example: Asia/Shanghai }
    has_completed_profile:                                       # ← 新增
      type: boolean
      description: 'COSTRA-158: 用户是否完成资料补全（首登 false · PATCH /users/me 成功后 true）'
    created_at: { type: string, format: date-time }
    updated_at: { type: string, format: date-time }
```

#### G · server 单测（新建 1 文件 + 修订 1 文件）

**新建 `server/test/users.test.ts`**（参照 `server/test/entries.test.ts` 风格 · 估 200 行 · 至少 8 测）：

| # | 测 | 期望 |
|---|---|---|
| 1 | GET /v1/users/me 未登录 | 401 UNAUTHENTICATED |
| 2 | GET /v1/users/me 登录后 | 200 + User schema 完整字段 + has_completed_profile=false（首登）|
| 3 | PATCH /v1/users/me 未登录 | 401 |
| 4 | PATCH /v1/users/me body 全空 | 400 INVALID_ARGUMENT |
| 5 | PATCH /v1/users/me nickname='张三' | 200 + nickname='张三' + has_completed_profile=true |
| 6 | PATCH 第二次 nickname='李四' | 200 + has_completed_profile 保持 true |
| 7 | PATCH avatar_url=null 显式清空 | 200 + avatar_url=null + has_completed_profile=true |
| 8 | PATCH nickname 超长 33 字符 | 400 INVALID_ARGUMENT |

**修订 `server/test/auth.test.ts`**：
- wx-login 200 响应断言加 `user.has_completed_profile === false`（首登）

#### H · miniprogram TokenRaw 类型加 has_completed_profile（修订 1 文件 · 1 行）

**`miniprogram/services/auth.ts` line 18~28** TokenRaw.user：

```ts
user: {
  id: string;
  nickname: string;
  avatar_url: string | null;
  has_completed_profile: boolean;   // ← 新增（COSTRA-158）
};
```

mockExchange（line 230~243）也要加：
```ts
user: {
  id: `mock-user-${seed.slice(0, 4)}`,
  nickname: '测试用户',
  avatar_url: null,
  has_completed_profile: true,   // ← mock 用户视为已补全（避免 mock 模式下 home 页常显"完善资料"入口）
}
```

#### I · miniprogram computeHasProfile 改严格判定（修订 1 文件）

**`miniprogram/utils/profile.ts`** 完全改写：

```ts
// utils/profile.ts · 用户画像判定辅助
// 卡号：COSTRA-158 · 替换 COSTRA-157 间接判定（nickname 字符串比较）为严格事实判定
//
// COSTRA-157 旧实装：u.nickname !== defaultNickname（代理判定 · Human 否决 2026-05-19 09:42）
// COSTRA-158 新实装：u.has_completed_profile（事实字段 · server 显式标记）
//
// 语义优势：
//   - 用户改名为 '微信用户' 不误判（之前会误判）
//   - server 升级 default nickname 客户端不需要跟改
//   - 多端同账号一致（之前是字符串比较 · 同账号同步）

interface UserLike {
  has_completed_profile?: boolean;
}

export function computeHasProfile(u: UserLike | null | undefined): boolean {
  return !!(u && u.has_completed_profile);
}
```

#### J · miniprogram pages/home/index.spec.ts 测试更新（修订 1 文件）

- 删除"边界用例：nickname === defaultNickname → hasProfile=false"（边界已不存在）
- 新增："has_completed_profile=true → hasProfile=true（不论 nickname 是否撞库 default）"
- 新增："has_completed_profile=false 缺失 → hasProfile=false"

#### K · 顺手关 FU-COMMON-MINIAPP-PATCH-LIMIT（修订 client + server · 2 文件）

> **决策点（dispatch §3.5 子决策）**：本项有两个等价选项 · R1 实装时由 backend-dev 与 miniapp-dev 共同决策（Card-Review 时可建议 · 最终 R1 时拍板）

**选项 K1 · server middleware 兼容（client 不动）**：
- `server/src/app.ts` 注册 `methodOverrideMiddleware`（如不存在则新建）：识别 `X-HTTP-Method-Override` header · 把 POST 重写为 PATCH/DELETE
- client `request.ts:88` 既有 `X-HTTP-Method-Override` header 降级保持
- ✅ 客户端 0 改动 · 兼容多种场景
- ❌ middleware 增 server 复杂度

**选项 K2 · client 改用真 PATCH（server 不动 · 但 wx.request 不支持 PATCH）**：
- 不可行 · wx.request 类型签名物理上不支持 PATCH · 这是平台限制（FU 标的核心）

**选项 K3（推荐）· 接受平台限制 + 文档化（不动 server middleware）**：
- COSTRA-158 仅修 hasProfile 严格判定 + /users/me 实装
- client request.ts 既有 X-HTTP-Method-Override 降级保持（COSTRA-102 已实装）
- server PATCH /users/me handler 同时注册 POST /users/me handler · 在 POST handler 内识别 `X-HTTP-Method-Override: PATCH` 后委托给 PATCH handler · 仅在 users 路由内做 · 不全局
- 这样实质保持 client 不动 + server 兼容 · 但作用域最小

> **R1 实装时建议 K3**（最小作用域兼容）· 但 backend-dev 可在 R1 实装中提出更优方案 · 走 D-017 §2.4 验证问题响应 SOP

**FU-COMMON-MINIAPP-PATCH-LIMIT 关闭条件**：
- server PATCH /users/me 路由实装（K3 兜底）
- E2E 实测：client login 成功后真调 PATCH 到 server · 200 返回（不再 404 soft-fail）
- 关闭时机：本卡 R1 完成 + Human 实测后

### 2.2 协议对齐（1 项）

- ✅ 改 `server/api/openapi.yaml` User schema（F 项 · 1 行加 has_completed_profile）
- ✅ POST /users/me（K3 兜底） · 是否在 OpenAPI 显式声明？**不声明**（保持 OpenAPI 纯净 · POST /users/me 是工程兼容层 · 文档化在 server/README.md 即可）
- ✅ docs/api/error-codes.md 不变

### 2.3 文档（0 项）

- 不写新文档 · history 段 4"交接"明示 Human 实测路径
- engineering-guidelines / common-contract 是否要加 method override 说明？**留 follow-up**（不阻本卡）

---

## §3 DoD（可度量 · 18 项）

### §3.1 主交付（11 项）

- [ ] A · `server/db/migrations/0005_users_has_completed_profile.sql` 新建 · `psql` 执行幂等
- [ ] B · `server/src/repositories/userRepo.ts` UserEntity/UserRow/rowToEntity/findByOpenid/findById/create 加 has_completed_profile · updateProfile 新增方法 · 8~10 行内
- [ ] C · `server/src/services/authService.ts` AuthTokenPair.user.has_completed_profile + toUserView 入参/返回加字段 · 5 行内
- [ ] D · `server/src/routes/users.ts` 新建 · 含 GET + PATCH（+ POST K3 兜底） · 100~150 行
- [ ] E · `server/src/app.ts` registerUsersRoutes(v1) + import · 2 行
- [ ] F · `server/api/openapi.yaml` User schema 加 has_completed_profile + required · 3 行
- [ ] G · `server/test/users.test.ts` 新建 · ≥ 8 测 · 含 K3 POST + Method-Override 兼容测
- [ ] G' · `server/test/auth.test.ts` 修订 · wx-login 200 断言含 has_completed_profile=false · 1 测改
- [ ] H · `miniprogram/services/auth.ts` TokenRaw.user.has_completed_profile + mockExchange · 2 行
- [ ] I · `miniprogram/utils/profile.ts` computeHasProfile 改严格判定 · 全文件改写 · 注释更新
- [ ] J · `miniprogram/pages/home/index.spec.ts` 测试更新 · 删边界用例 + 加新用例 · 净改 ~5 行

### §3.2 闸门（≥ 7 项 · 必跑全绿才提交）

| # | 闸门 | 命令 | 期望 |
|---|---|---|---|
| G1 | typecheck | `npm run typecheck` | 0 错 |
| G2 | lint | `npm run lint` | 0 warn |
| G3 | test | `npm run test` | 全绿（含 server users.test.ts ≥ 8 测 + auth.test.ts 修订 + miniapp home.spec.ts 修订）|
| G4 | check:appjson | `npm run check:appjson` | exit 0 |
| G5 | check:tooling | `npm run check:tooling` | exit 0 |
| G6 | check:whitelist | `npm run check:whitelist` | exit 0 |
| G7 | check:libversion | `npm run check:libversion`（如已存在 · COSTRA-126+ FU-LIBVERSION-DEV-GUARD 待 Sprint-2 末做 · 暂跳过）| - |
| **G8** | **users 路由真实存在**（防止再次 OpenAPI 与实装漂移）| `grep -E "registerUsersRoutes\|/users/me" server/src/app.ts \| wc -l \| tr -d ' '` | ≥ 2（import + register）|
| **G9** | **DB migration 幂等**（重复跑不报错）| `psql -c "ALTER TABLE users ADD COLUMN IF NOT EXISTS has_completed_profile BOOLEAN..."` 等价测试 · 用 `\d users` 验证列存在 | column 存在 |

### §3.3 反向验证（3 项）

- [ ] G10 · 临时把 `userRepo.updateProfile` 内 `has_completed_profile = TRUE` 改为 `= FALSE` → users.test.ts 测 5/6/7 FAIL → revert → PASS
- [ ] G11 · 临时把 `computeHasProfile` 改回 `nickname !== defaultNickname` → home.spec.ts 边界用例（不存在的）依然过 · 但断言 has_completed_profile 字段的新用例 FAIL → revert → PASS
- [ ] G12 · E2E 验证（Human 实测前置）：mock 模式下 login → home 页不显示"完善资料"入口（mockExchange 已设 has_completed_profile=true）

### §3.4 协议事实源对账（COSTRA-156 立的范式）

- [ ] G13 · `whitelist-check.mjs` 现有规则 D 仍绿（fastify register prefix vs OpenAPI servers 一致性 · 不被本卡破坏）
- [ ] G14 · OpenAPI User schema required 含 has_completed_profile · 与 server toUserView 返回字段对账（grep）

---

## §4 强制阅读清单（subagent spawn 时 §G inline）

### §4.1 必读

1. **本派单档全文**（唯一执行依据）
2. **Card-Review 报告**（实装前必读 · D-014-a 产物）：`.team/reviews/COSTRA-158/card-review-round-1-tech.md`（同轮产出）
3. **OpenAPI /users/me 现状**：`server/api/openapi.yaml:127-158` + User schema `:875-884`
4. **DB users 表 schema**：`server/db/migrations/0001_init.sql:14-25`
5. **userRepo 现状**：`server/src/repositories/userRepo.ts`（B 项目标）
6. **authService 现状**：`server/src/services/authService.ts`（C 项目标 · line 72~88 toUserView · line 117~123 wxLogin upsert · line 180~187 refresh return）
7. **既有路由范式**：
   - `server/src/routes/auth.ts`（D 项参考 · auth middleware 用法）
   - `server/src/routes/entries.ts`（D 项参考 · schema validation 风格）
   - `server/src/routes/healthz.ts`（D 项参考 · 最简模板）
8. **app.ts v1 prefix 注册**：`server/src/app.ts`（E 项目标 · COSTRA-156 已建立 v1 容器）
9. **既有单测范式**：
   - `server/test/auth.test.ts`（G' 修订目标 + G 单测风格参考 · auth middleware 注入）
   - `server/test/entries.test.ts`（G 单测风格参考 · schema validation 测试 · status 校验）
10. **client TokenRaw**：`miniprogram/services/auth.ts:18-28`（H 项目标）
11. **client computeHasProfile**：`miniprogram/utils/profile.ts`（I 项目标 · 完全改写）
12. **client home spec**：`miniprogram/pages/home/index.spec.ts`（J 项目标）
13. **error-codes.md**：`docs/api/error-codes.md`（D 项错误响应一致性）

### §4.2 按需

- `.team/decisions/D-008-subject-strategy.md`（has_completed_profile 与主体策略无关 · 但确认背景）
- `.team/decisions/D-022-review-tech-evaluation-matrix-v2.md`（review-tech 评分维度）
- `.team/dispatch/COSTRA-156-backend-add-v1-prefix.md`（最近 server 改动派单 · v1 prefix 范式）
- `.team/dispatch/COSTRA-104-backend-sync-push-entries-crud-cutout-trinity.md`（entries CRUD 范式 · D 项参考）
- `.team/follow-ups/README.md`（族 E FU-COMMON-MINIAPP-PATCH-LIMIT 现状）

---

## §5 硬约束（不可违反）

### §5.1 工作区铁律

- ✅ **server 装扮档可写**：
  - `server/db/migrations/0005_users_has_completed_profile.sql`（新建）
  - `server/src/repositories/userRepo.ts`（改）
  - `server/src/services/authService.ts`（改）
  - `server/src/routes/users.ts`（新建）
  - `server/src/app.ts`（改 · 注册路由 · 2 行）
  - `server/api/openapi.yaml`（改 User schema · 3 行）
  - `server/test/users.test.ts`（新建）
  - `server/test/auth.test.ts`（修订 · 加 has_completed_profile 断言）
  - `.team/members/backend-dev/state.md` + history
- ✅ **miniapp 装扮档可写**：
  - `miniprogram/services/auth.ts`（改 TokenRaw + mockExchange · 2 行）
  - `miniprogram/utils/profile.ts`（完全改写 · 严格判定）
  - `miniprogram/pages/home/index.spec.ts`（修订 · 删边界用例 + 加新用例）
  - `.team/members/miniapp-dev/state.md` + history
- ✅ **共用可写**：`.team/follow-ups/README.md`（关 FU-COMMON-MINIAPP-PATCH-LIMIT · 修订 FU-102-PROFILE-REFUSE-UI 状态）
- ❌ **不可写**：`docs/`（除非派单明示）· `infra/` · `.team/dispatch/COSTRA-158-*.md`（dispatch 已锁 · 走 D-015 revise-round-N 修）· 其他 `.team/members/{other-role}/`

### §5.2 严守 INVEST small（5 点）

- 5 点 · ~3.5 小时 R1 实装时间盒
- 11 项虽多但单点修改密度高 · 无新业务逻辑发明 · 现有范式齐全
- 若实装中发现 scope 超 5 点 → 触发 D-017 §2.4 验证问题响应 SOP · 不硬干

### §5.3 K3 兜底子决策

- R1 实装中由 backend-dev 与 miniapp-dev 协作判定最终方案（K1 全局 middleware vs K3 局部 POST handler）
- 若 backend-dev 提出更优方案（如 fastify-method-override 库），走 D-017 §2.4 报告 + 等 Human 决策
- **默认 K3**：仅在 users 路由 POST handler 内识别 `X-HTTP-Method-Override: PATCH` 后委托

### §5.4 D-016 同轮兑现

- 派单 → Card-Review → R1 实装（backend-dev 段 + miniapp-dev 段）→ review-tech R1 在同一对话轮内连续 spawn
- 若 R1 实装时间超出对话轮限制 · Orchestrator 可主动暂停 · 等下次会话续 R1（破 D-016 但不破 D-014-a/b）

### §5.5 D-018 SBAI 装扮档铁律

- 一次性装扮 · 任务结束销毁
- backend-dev 段不 commit · miniapp-dev 段统一 commit（COSTRA-157 范式复用）

### §5.6 D-022 v2.0 评分表（review-tech R1 时适用 · 40 分制 · 第 6 次实战）

| 维度 | 满分 | 本卡重点 |
|---|---|---|
| C1 契约对齐 | 5 | OpenAPI User schema 加字段 + path 实装齐全 + 错误码使用 ErrorCode 枚举 |
| C2 代码质量 | 5 | userRepo.updateProfile 三态语义（undefined/value/null）正确 · routes/users.ts 单测覆盖完整 |
| C3 架构合理 | 5 | repo/service/route 三层职责清晰 · K3 兜底位置（users.ts 内 POST handler）合理 |
| C4 数据完整 | 5 | has_completed_profile 单调性（一旦 TRUE 不降级）· DB DEFAULT FALSE · backfill 决策记录 |
| C5 安全 | 5 | auth middleware 校验 · 不信任 client userId · body schema 校验 · X-HTTP-Method-Override 仅 users 路由识别 |
| C6 可测性 | 5 | users.test.ts ≥ 8 测 · 含 K3 兼容测 · auth.test.ts 修订 · home.spec.ts 修订 · 反向验证 G10/G11 |
| C7 纪律 | 5 | INVEST small（5 点 vs 实际改动量）· D-016 同轮 · D-018 双装扮档单 commit · commit footer Co-Authored-By |
| C8 runtime 加载性 | 5 | DB migration 幂等 · 启动期 register 顺序无 race · client TokenRaw 类型匹配 |
| C9 性能 | 0 | 不适用（无 hot path · users 调用频率低）|
| C10 SBAI 流程合规 | 5 | 双装扮档严守工作区铁律 · history 5 段齐全 · state.md §2 §3 §7 同步 |

---

## §6 提交（D-012 单卡即提交 · D-018 commit footer）

R1 commit message 模板（全小写 commitlint 校验）：

```
feat(repo): /users/me + has_completed_profile strict profile judgment (costra-158)

sprint-2 main line card 7: complete /users/me path + strict has_completed_profile field

server side (8 changes):
- a: db migration 0005 add has_completed_profile column (default false)
- b: userrepo entity/row mapping + updateprofile method (with optimistic locking)
- c: authservice toUserView returns has_completed_profile
- d: new routes/users.ts (get + patch + post k3 fallback for x-http-method-override)
- e: app.ts register users routes in v1 subscope
- f: openapi user schema add has_completed_profile field
- g: server test users.test.ts 8+ tests
- g': auth.test.ts assert has_completed_profile=false on first login

miniapp side (3 changes):
- h: tokenraw.user adds has_completed_profile field (real + mock)
- i: utils/profile.ts computehasprofile uses strict factual judgment
- j: home.spec.ts updated test cases (remove boundary, add new)

closes:
- fu-common-miniapp-patch-limit (server patch route now exists, k3 method-override compat)
- fu-102-profile-refuse-ui boundary risk (costra-157 r1 indirect judgment replaced)

human decision 2026-05-19 09:42 rejected probabilistic boundary acceptance.
human decision 2026-05-19 09:44 chose plan d (single 5pt card, sprint-2 inline).

gates: typecheck 0 / lint 0 warn / test all green / 6 checks pass / g8 users route grep ≥ 2 / g10/g11/g13/g14 verified.
reverse verify: g10 (updateprofile false) / g11 (compute fallback) confirmed.

invest small 5pt · double-subagent single commit (q4-a precedent) · d-016 same-turn fulfilled.
d-022 v2.0 evaluation matrix 6th implementation.

refs: .team/follow-ups/readme.md · .team/dispatch/costra-158-*.md · costra-101 / costra-102 / costra-156 / costra-157

co-authored-by: backend-dev <subagent>
co-authored-by: miniapp-dev <subagent>
```

> 注：commit body 行长 ≤ 100 字符（commitlint body-max-line-length）

---

## §7 估点 / 时间盒

- **估点**：5 点
- **时间盒**：R1 实装 ≤ 210 分钟（3.5 小时）
- **R1 拆分时长预估**：
  - backend-dev 段（~150 min）：
    - A migration：15 min
    - B userRepo：30 min
    - C authService：5 min
    - D routes/users.ts：60 min（核心 · 含 K3 兜底）
    - E app.ts register：5 min
    - F openapi.yaml：5 min
    - G/G' 单测：60 min
    - state.md + history：10 min
  - miniapp-dev 段（~45 min · 含 commit）：
    - H TokenRaw：5 min
    - I computeHasProfile：5 min
    - J home.spec.ts：15 min
    - 闸门跑 + commit + state.md + history：20 min
  - **总和：~195 min · 留 15 min 缓冲**

---

## §8 联合 Sprint-2 末 Retro 议题（158 完成后兑现）

- 🆕 **议题候选 · 契约-实装 gap 防漏检**：COSTRA-101 R1 时 OpenAPI 已含 /users/me · 但实装只交付 auth 三端点 · 当时合理（INVEST small）· 但**没有任何机制持续追踪未实装契约** · 直到 1 个月后才暴露
  - 修复建议：CI 加 `check:openapi-impl-coverage` 脚本 · 静态扫 OpenAPI paths 与 fastify register 是否一一对应 · 缺失的 path 标 P2 follow-up
  - 与 COSTRA-156 whitelist-check 规则 D 范式一致 · 是规则 E 候选
- 🆕 **议题候选 · 代理判定（proxy judgment）反模式**：COSTRA-157 用 `nickname !== defaultNickname` 推断"是否完成资料补全" · Human 否决 · 议入"代码评审反模式清单"
  - 反模式：用字符串比较代理事实判定
  - 好例：用显式布尔字段（has_completed_profile）做事实判定
- 🆕 **议题候选 · "概率极低就接受" 反模式**：COSTRA-157 dispatch 用"概率极低"作为接受边界缺陷的理由 · Human 否决 · 议入"边界条件处置 SOP"
  - 反模式：拿概率论说服自己 · 不解决根因
  - 好例：要么消除边界（事实判定）· 要么有自动检测/恢复机制 · 或风险足够低（数学证明 + 监控）

---

## §9 附录 · Human 验证清单（R1 完成后 · 5 分钟实测）

| # | 步骤 | 期望 |
|---|---|---|
| 1 | server 启动 + db migrate up | `\d users` 显示 has_completed_profile 列（DEFAULT FALSE）|
| 2 | 模拟器冷启 · 拒绝 wx.getUserProfile 授权 → 一键登录 → 跳 home | ✅ 显示"你好，微信用户" + 右上角"完善资料 →"（has_completed_profile=false 触发）|
| 3 | 模拟器重启 · 同意 wx.getUserProfile 授权 → 一键登录 → 跳 home | ✅ 显示真实昵称 + **无**"完善资料 →"（PATCH /users/me 200 + has_completed_profile=true）|
| 4 | DevTools 看网络 · 确认步骤 3 中 PATCH /users/me 200（不再 404 soft-fail）| ✅ 200 |
| 5 | 退出登录 · 重登（已有用户·has_completed_profile 持久 true）| ✅ 仍无"完善资料 →"入口 |
| 6 | 极端场景：DevTools 改 storage user.nickname 为 '微信用户' · 但 has_completed_profile 保持 true · 重启 | ✅ 不显示"完善资料 →"（COSTRA-157 边界已消除） |

如全部 PASS → Human 发 `approve:COSTRA-158` → COSTRA-158 整卡 CLOSED + FU-COMMON-MINIAPP-PATCH-LIMIT 实质闭合。

---

_本档由 Orchestrator 在 2026-05-19 09:44 落盘 · Human D-recommended 决策同轮 · 等 Card-Review R1（D-014-a 流程启动）_
