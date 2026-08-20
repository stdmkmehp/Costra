# GM 访问授权与审计手册

> 关联设计：`docs/ops/gm-impersonate-design.md`
> 适用：测试/运维在 prod 与 staging 给单人授予 GM 权限、回收、识别伪造账号、审计 impersonate 行为。

## 1. 授权（单人）

GM 权限唯一写入路径是运维 SQL，**没有任何 API 可写 `users.is_gm`**（`PATCH /users/me` 是 `additionalProperties:false` 白名单，天然排除）。

```sql
-- 按微信 openid 授权
UPDATE users SET is_gm = TRUE, updated_at = now() WHERE wx_openid = '<openid>';

-- 或按 user id 授权
UPDATE users SET is_gm = TRUE, updated_at = now() WHERE id = '<uuid>';
```

授权后**服务端校验即时生效**：被授权人下次请求任意 `/v1/gm/*` 即放行。
客户端"GM 工具"入口需被授权人重新登录或下次 `GET /users/me` 刷新后才可见（`is_gm` 经登录响应与 /users/me 双通道下发）。

## 2. 回收（即时生效）

```sql
UPDATE users SET is_gm = FALSE, updated_at = now() WHERE id = '<uuid>';
```

因为 `requireGm` 是**实时查库**（非 JWT claim），回收后该用户**下一个 `/v1/gm/*` 请求立即 403**，无需等 token 过期、无需重启。

## 3. 查询当前 GM 名单

```sql
SELECT id, wx_openid, nickname, created_at
FROM users WHERE is_gm = TRUE
ORDER BY created_at DESC;
```

## 4. 识别/清理伪造账号

GM 伪造登录的 openid 由服务端自动分配（`gm_fake_` + 32 位 hex，每次「新建伪造账号登录」生成一个独立账号），与真实微信 openid（以 `o` 开头）物理隔离，DB 内一眼可辨。
复登某个已建伪造账号走用户列表的 `user_id` 路径（伪造账号注册时间最新，排在列表最前），客户端不支持也不接受手动指定 openid。

```sql
-- 列出全部伪造账号
SELECT id, wx_openid, nickname, created_at
FROM users WHERE wx_openid LIKE 'gm\_fake\_%' ESCAPE '\'
ORDER BY created_at DESC;

-- 批量清理伪造账号（先确认 no 结果符合预期，再执行 delete）
-- DELETE FROM users WHERE wx_openid LIKE 'gm\_fake\_%' ESCAPE '\';
```

> 清理前务必确认该 openid 不会被其他真实 family/ledger 引用（伪造账号仅在测试切换时建立，默认无真实数据往来）。

## 5. 审计 impersonate 行为

每次 GM 登录（user_id 或 create_fake 路径）服务端打 warn 级日志：

```
msg="gm impersonate login" gmUserId=<...> mode="user_id"|"fake_auto" targetUserId?<...> fakeOpenid?<...>
```

查询：

```bash
docker exec costra-server sh -c "cat /data/logs/server/*.log" \
  | jq 'select(.msg=="gm impersonate login")'
```

或宿主机轮转前的实时流（依 logging-strategy-spec.md §5 落入 /data/logs/）。

## 6. 安全须知

- GM token 泄露 = 可登录任意用户；授权面务必极小（仅授权可信任的运维单人）。
- 微信审核账号非 GM，看不到客户端入口与按钮（仅 `is_gm=true` 渲染）。
- 普通用户即便伪造本地 `is_gm` 也绕不过服务端实时查库校验。
- impersonate 使用的 client_fp 是测试设备指纹，与真实用户设备不同，不会踢掉真实用户的在线会话。

## 7. 常见误操作

| 操作 | 结果 | 纠正 |
|---|---|---|
| `UPDATE users SET is_gm=TRUE` 不带 WHERE | 全员 GM | 立即 `SET is_gm=FALSE WHERE ...`，仅保留授权名单 |
| 授权后客户端看不到入口 | 需重登或刷 /users/me | 正常，非 bug |
| 回收后仍能 impersonate | 缓存/旧 token | 下一请求即 403，等待 token 自然滑窗或重登 |
| 旧客户端手填 `fake_openid` 调 impersonate | 契约已收窄（仅 `user_id`/`create_fake` 二选一），400 | 升级客户端，伪造账号由系统自动分配 |
