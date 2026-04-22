# 流程时序 · 微信登录闭环

> **卡号**：COSTRA-010 · **关联 Story**：COSTRA-101 / 102 / 103
> **耗时预算**：整体 ≤ 2s（p95） · `wx.login` 本地 ≤ 300ms · `code2Session` 服务端侧 ≤ 500ms · JWT 签发 ≤ 50ms

---

## 1. 场景与目标

- 用户首次进入 Costra 小程序 → 3 秒内拿到 `accessToken`，落 `wx.storage`，跳首页
- 冷启/热启检测 token 过期 → 静默 refresh，不打断用户
- token 无法恢复 → 回到 `pages/launch` 重新走 wx.login

---

## 2. 主路径（首次登录）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant MP as Costra 小程序
    participant BE as Costra 后端
    participant WX as 微信开放平台<br/>(api.weixin.qq.com)

    U->>MP: 打开小程序（冷启）
    activate MP
    MP->>MP: onAppLaunch → 读 wx.storage.accessToken
    Note over MP: 无 token → 跳 pages/launch
    MP->>U: 展示「用微信登录」按钮
    U->>MP: 点击登录
    MP->>MP: wx.login()  ≤300ms
    MP->>BE: POST /v1/auth/wx-login { code }
    activate BE
    BE->>WX: GET /sns/jscode2session?appid&secret&js_code
    activate WX
    WX-->>BE: { openid, session_key, unionid?, errcode }
    deactivate WX
    BE->>BE: upsert users (openid)<br/>签 accessToken(15m) + refreshToken(30d)<br/>写 audit_logs
    BE-->>MP: 200 { accessToken, refreshToken, expiresIn, user }
    deactivate BE
    MP->>MP: wx.setStorage(accessToken / refreshToken)
    MP->>U: wx.reLaunch(pages/home/index)
    deactivate MP
```

**耗时预算**：① wx.login ≤ 300ms · ② 后端整体 ≤ 500ms（含 code2Session 和入库）· ③ 客户端存储 + reLaunch ≤ 200ms · 端到端 **p95 ≤ 1.2s**。

---

## 3. 热启 + token 过期静默续签

```mermaid
sequenceDiagram
    autonumber
    participant MP as 小程序
    participant BE as 后端

    MP->>MP: onAppShow：token 存在但 expiresAt ≤ now + 60s
    MP->>BE: POST /v1/auth/refresh { refreshToken }
    alt refresh 成功
        BE-->>MP: 200 { accessToken, expiresIn }
        MP->>MP: 覆盖 storage；继续原路由
    else refresh 失败（401 invalid_token）
        BE-->>MP: 401 problem+json
        MP->>MP: 清 storage → wx.reLaunch(pages/launch)
    end
```

**风险护栏**：
- 同时并发多个 401 时，请求队列在 `services/request.ts` 侧做**单次 refresh 互斥锁**（对齐 ADR-0004 §3）
- `refreshToken` 永不放 URL，只在 body / Authorization 里

---

## 4. 手机号绑定（R2 启用，MVP 可跳过）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant MP as 小程序
    participant BE as 后端

    U->>MP: 在 pages/me 点「绑定手机」
    MP->>U: 展示 button open-type="getPhoneNumber"
    U->>MP: 点击授权
    MP->>MP: 获得 e.detail.code（2024 年新版）
    MP->>BE: POST /v1/auth/bind-phone { code }
    BE->>BE: 调微信 getPhoneNumber 接口解密 code
    BE->>BE: users 表写入 phone + auditLog
    BE-->>MP: 200 { user }
    MP->>U: Toast：绑定成功
```

引用：[getPhoneNumber（新版）](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)。

---

## 5. 错误兜底矩阵

| 错误码 | 场景 | 客户端行为 | 用户感知 |
|---|---|---|---|
| `wx.login` fail | 网络不通 | 重试 1 次，1s 退避 | Toast "登录失败，请检查网络" |
| `code2Session` errcode=40029 | code 失效 | 重新 wx.login | 无感知 |
| `40163` code 已使用 | code 被复用 | 重新 wx.login | 无感知 |
| `refresh` 401 | refreshToken 失效 | 清 storage → 回 launch | "登录已过期" |
| 后端 5xx | 服务不可用 | 指数退避 3 次 | "稍后重试" |

---

## 6. 存储字段（对齐 ADR-0004 §3）

| Key | 内容 | 有效期 |
|---|---|---|
| `accessToken` | JWT | 15 min |
| `refreshToken` | 不透明字符串 | 30 d（可滑动）|
| `tokenExpiresAt` | ISO string | 同 accessToken |
| `currentUser` | `{ userId, nickName, avatarUrl, familyId? }` | 持久 |

---

## 7. 官方引用

- `wx.login`：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html
- `code2Session`：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
- `getPhoneNumber`：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html
- `wx.reLaunch`：https://developers.weixin.qq.com/miniprogram/dev/api/route/wx.reLaunch.html

---

**Refs**: COSTRA-010 · **Impacts**: COSTRA-020 `/v1/auth/*`、COSTRA-030 request 层 / auth.service、COSTRA-050 冒烟-1
