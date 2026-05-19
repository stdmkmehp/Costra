# COSTRA-162 · dev mockLogin runtime toggle（FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE 转正）

> **派单时间**：2026-05-19 20:50（Sprint-3 顺手 · miniapp-dev · ~1 点小卡）
> **状态**：dispatch 已落盘 · 等 Human 拍板启动（D-024 §2.3）
> **依赖**：无（独立 fix）
> **下游解锁**：真链路实测便利性提升 · D-022 §4.1 runtime 实测前置铁律的工程支撑 · 降低 Sprint-3 起 154/152/153 实测频次的摩擦成本

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech`（轻量审 · ≤ 15min）| 等启动 |
| **R1 实装** | `costra-miniapp-dev` | 等卡审 PASS |
| **R1 Review** | `costra-review-tech` | 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-162`（攒批）| 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- 2026-05-19 19:43~19:53 Human 实测 COSTRA-157+158 期间立案
- 切真链路需手改 `miniprogram/services/env.ts:18` 源码 + 重新编译 · 测完还原源码 · 不便利且易遗忘还原
- Sprint-3 起 154/152/153 真链路实测频次会增加 · 越早做收益越大

### 1.2 候选方案（Card-Review 决策）
- **(a)** 读 storage `__costra_dev_flags_v1` · 提供 console 入口（推荐 · 简单）
- **(b)** URL 参数（小程序无 URL 参数 · 不通）
- **(c)** 编译期 process.env 通过 build 脚本注入（更彻底 · 但需新建构建基础设施 · 与 staging/prod 同范式 · COSTRA-160 落地后联动）

**推荐方案 (a)**：本卡只做 storage 入口 · build 脚本留给 COSTRA-160 顺手做。

---

## §2 Scope（4 项 · 估点 1 · INVEST small）

### 2.1 主交付

#### A · env.ts 升级 dev.mockLogin 读 storage
- `miniprogram/services/env.ts` 当前 `dev.mockLogin: true` 写死
- 改为 runtime 读：`mockLogin: getStorageBoolSync('__costra_dev_flags_v1.mockLogin', true)`
- 默认 true（保持向后兼容）· storage 显式设 false 时切真链路

#### B · 提供 console 入口（dev-only · prod build strip）
- `miniprogram/app.ts` onLaunch 内（dev env 守卫）：
  ```ts
  if (this.globalData.env.name === 'dev') {
    (wx as any).__costra_dev__ = {
      setMockLogin: (v: boolean) => wx.setStorageSync('__costra_dev_flags_v1', { mockLogin: v }),
      getDevFlags: () => wx.getStorageSync('__costra_dev_flags_v1') || {},
    };
  }
  ```
- 真链路实测：console 一行 `wx.__costra_dev__.setMockLogin(false)` → 重启 → 切真链路
- 还原：`wx.__costra_dev__.setMockLogin(true)` → 重启

#### C · 文档同步
- `miniprogram/services/env.ts` 注释段加 dev_flags 用法说明
- `docs/qa/costra-157-158-batch-human-smoke.md`（如已存在）或 `docs/qa/sprint-2-batch-human-smoke.md` 加"切真链路便利方法"段

#### D · follow-ups
- FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE: open → closed @ COSTRA-162

### 2.2 不在本卡范围
- ❌ build 脚本注入 process.env → 留 COSTRA-160 顺手或独立 FU
- ❌ 其他 dev_flags 字段（仅 mockLogin · 其他需要时再扩）→ 留观察

---

## §3 DoD

6 闸门 + G7（dev_flags storage 单测）+ G15。反向验证：① 默认 storage 空 → mockLogin = true · ② setStorageSync false → mockLogin = false · ③ prod env 不暴露 wx.__costra_dev__。

D-025 扫描预测：全不命中。

---

## §4 强制阅读清单

1. 本派单档 + Card-Review 报告
2. **env.ts 现状**：`miniprogram/services/env.ts`（59 行 · ENV_MAP 常量）
3. **app.ts onLaunch**：`miniprogram/app.ts`
4. **storage 范式**：`miniprogram/services/storage.ts`
5. **dev_flags 命名空间**：`__costra_dev_flags_v1`（与 `__costra_token_v1` / `entry:*` / `outbox:*` 同 v1 命名空间）

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`miniprogram/services/env.ts` · `miniprogram/app.ts` · `miniprogram/services/env.spec.ts`（如新建）· `docs/qa/` 实测手册（如更新）· `.team/members/miniapp-dev/` · `.team/follow-ups/README.md`
- ❌ 不可写：server/ · infra/

### §5.2 INVEST small（1 点）
- 时间盒 ≤ 30 分钟

### §5.3 commit footer
- `closes: FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE`

---

## §6 估点 / 时间盒
- 估点 1 点 · AI ~30 分钟 · Human 实测：模拟器 console 一行切换验证

---

**派单档结束 · 等 Human `start:COSTRA-162`。**
