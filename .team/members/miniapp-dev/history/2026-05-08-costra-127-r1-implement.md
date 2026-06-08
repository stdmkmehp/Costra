# COSTRA-127 R1 实装交付

- 卡号：COSTRA-127
- 日期：2026-05-08
- 类型：fix
- Owner：costra-miniapp-dev
- Refs：COSTRA-126 · FU-LAUNCH-C · D-017 Step 2 诊断

---

## §1 任务描述

接续上轮 D-017 Step 2 + Step 3 诊断（COSTRA-127 派单前），Human 拍板"全按推荐"（Q1-A 方案 B / Q2-A 2 点 P1 / Q3-A Human 实测 / Q4-A 直接进入实装）。

**核心问题**：`Expected updated data but get first rendering data` 在 lib 3.8.12 重新打开项目冷启动后仍 1 次残留（COSTRA-126 §4.2 实测）。

**真根因（D-017 Step 2 诊断，置信度 90%+）**：
- 场景 B：app bootstrap 直达 home + home onShow 同步 hasValidSession + setData · 无 bootstrap gate · 与 onLoad 的 .then gate 形成竞速
- 场景 D：login → switchTab(home) · switchTab 复用 home 旧实例 + onShow 同步执行

**方案 B 改动**：
- login.ts 两处 `switchTab` → `reLaunch`
- home/mine onShow 加 `bootstrapPromise.then()` gate

---

## §2 产出

### 2.1 代码改动

| 文件 | 改动 | 行数 |
|---|---|---|
| `miniprogram/pages/login/index.ts` | 两处 switchTab→reLaunch + 顶部注释 | ~6 行 |
| `miniprogram/pages/home/index.ts` | onShow 改写为 bootstrap gate 形式 + 顶部注释修正 | ~12 行 |
| `miniprogram/pages/mine/index.ts` | onShow 改写为 bootstrap gate 形式 + 顶部注释修正 | ~12 行 |

### 2.2 文档改动

| 文件 | 改动 |
|---|---|
| `docs/devops/libversion-upgrade.md` | §3.4 v4→v5 措辞 + §3.6 反模式 #6 新增 + §4.2/§4.3 更新 |

### 2.3 管理文件改动

| 文件 | 改动 |
|---|---|
| `.team/dispatch/COSTRA-127-*.md` | 新建 dispatch |
| `.team/follow-ups/README.md` | 新增 §f.6 |
| `.team/members/miniapp-dev/state.md` | §2/§3/§7 收尾 |
| `.team/members/miniapp-dev/history/2026-05-08-costra-127-r1-implement.md` | 本文件 |

### 2.4 commit

- **commit 1**：`fix(miniapp): replace switchTab with reLaunch + onShow bootstrap gate (COSTRA-127)`
- **commit 2**：`docs(repo): costra-127 fu-launch-c true-close + libversion v5 + anti-pattern #6 (COSTRA-127)` + footer `Refs: COSTRA-126, COSTRA-127`

---

## §3 关键决策

1. **DoD (b) home onShow 改写**：将同步 setData 包装到 `bootstrapPromise.then()` 内，确保 bootstrap 完成后再执行业务逻辑
2. **DoD (c) mine onShow 同步修正**：与 home 对齐结构，消除"onShow 必在 onLoad 之后"错误假设
3. **DoD (d) §3.4 v5 措辞**：明确双因（SDK race 已修复 + 业务时序问题）
4. **DoD (d) §3.6 反模式 #6**：立案"switchTab + onShow 同步 setData"坏例 + "reLaunch + onShow bootstrap gate"好例

---

## §4 遗留

- **FU-LAUNCH-C 状态**：`degraded-to-p3-observe` → 待 Human 实测后 `closed @ COSTRA-127`
- **Human 实测 SOP**：5 步复现验证（冷启动 → 清缓存 → 重新编译 → 观察 console → 手动登出再登录）
- **下一步**：等 Orchestrator spawn review-tech 形式 R1（可选）+ Human 终审 + 真机预览（Sprint-2 提审前）

---

## §5 state.md diff

### §2 active tasks（加）
```
- **🆕 COSTRA-127 · R1 实装已交付**（2026-05-08 · 方案 B 实装 + FU-LAUNCH-C true close + libversion v5 + 反模式 #6 · 等 Human 实测）
```

### §3 交付历史索引（加）
```
- **2026-05-08** · `history/2026-05-08-costra-127-r1-implement.md` · COSTRA-127 方案 B 实装 + FU-LAUNCH-C 真 closed
```

### §7 时间戳（加）
```
- **2026-05-08T18:30:00+08:00 · COSTRA-127 R1 实装交付**（SBAI v1.1 实战第 5 回 · 方案 B + libversion v5 + 反模式 #6 + FU §f.6 + state.md 收尾 · 六闸全绿 · 2 commit）
```

---

**文档结束 · 2026-05-08 · by `costra-miniapp-dev`（COSTRA-127 R1 实装）**
