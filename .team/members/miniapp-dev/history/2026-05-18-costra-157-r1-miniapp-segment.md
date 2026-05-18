# miniapp-dev · 2026-05-18 · COSTRA-157 · R1 miniapp segment

- subagent_spawn_ts: 2026-05-18T18:10:00+08:00
- subagent_finish_ts: 2026-05-18T18:22:00+08:00
- task_type: feature

## §1 任务描述

COSTRA-157 dispatch §2.1 B/C/D/E 项 + §2.2 F 项 miniapp 段实装。单卡双装扮档第 2 段（miniapp-dev）· 第 1 段 backend-dev 已落 A 项 + server F 项（未 commit 保留在工作树）· 本段统一 commit 含双段全部改动（Q4-A 决策）。

B 项：miniprogram 端硬编码昵称同步配置化（新建 `miniprogram/config/defaults.ts` + home/mine 改引用）。
C 项：login 页错误分支走 `mapError`（守 error-codes.md §0.5 红线 · FU-102-ERROR-MAPPER-INTEGRATION）。
D 项：home 页 onAvatarError handler 实装（FU-102-AVATAR-ONERROR）。
E 项：home 页拒绝授权降级 UI + "完善资料"临时入口（FU-102-PROFILE-REFUSE-UI · Q1-A + Q5-A）。
F 项：miniapp 单测覆盖（home.spec.ts 8 测 + 抽 utils/profile.ts 纯函数）。

## §2 产出

- 新增文件：`miniprogram/config/defaults.ts`（9 行 · 导出 defaultNickname 常量）
- 修改文件：`miniprogram/pages/home/index.ts`（+3 import / +hasProfile data / +computeHasProfile / +onAvatarError / +onTapCompleteProfile / hydrateUser 改造 · 净 +28 行）
- 修改文件：`miniprogram/pages/home/index.wxml`（+4 行 · greeting__action 完善 资料 入口）
- 修改文件：`miniprogram/pages/home/index.wxss`（+position:relative + .greeting__action · 净 +10 行）
- 修改文件：`miniprogram/pages/mine/index.ts`（+1 import / -1 hardcoded / +1 常量引用）
- 修改文件：`miniprogram/pages/login/index.ts`（+1 import / catch 段改走 mapError · -7/+6 行）
- 新增文件：`miniprogram/utils/profile.ts`（19 行 · computeHasProfile 纯函数 · 从 Page 层抽取便于单测）
- 新增文件：`miniprogram/pages/home/index.spec.ts`（67 行 · 8 测 · computeHasProfile 5 测 + defaults 对齐 1 测 + onAvatarError/onTapCompleteProfile 2 测）

## §3 关键决策

- **hasProfile 判定逻辑抽取**：从 hydrateUser 内联抽取到 `utils/profile.ts` 的 `computeHasProfile` 纯函数 · 避免单测时 mock Page()/wx 全局（派单档 F 项"如果 mock 太复杂可抽纯函数"路径）· 单测覆盖率更高
- **hasProfile 已知边界**（Card-Review P1-1 采纳）：`u.nickname === defaultNickname` 时误判 false · MVP 接受 · Sprint-3 Epic-D 落地后改用 `user.has_completed_profile`
- **mapError TOKEN_EXPIRED fallback**（P2-2 采纳）：代码注释说明 TOKEN_EXPIRED 落 catch 的 fallback 合理性 · request.ts 拦截器正常处理自动续签 · 若续签失败冒泡到 login catch · fallback '登录失败，请重试' 合理
- **greeting wxss 不破坏既有**：只追加 `position: relative`（原来 display:flex 保留）+ `.greeting__action` 新规则
- **login/index.spec.ts 不强制新建**：派单档"不存在 → 不强制" · login 页 mapError 改动通过 grep 反向断言 G9 验证

## §4 交接（给 review-tech R1）

- ✅ 6 项主闸门全绿：typecheck 0 / lint 0 warn / test 42+24 / check:appjson exit 0 / check:tooling exit 0 / check:whitelist exit 0
- ✅ G7 双端对账 = 1
- ✅ G8/G9/G10 反向验证完成
- ✅ 统一 commit 含 backend-dev 第 1 段所有改动（server/ 3 文件）+ miniapp 段全部改动
- ⚠️ review-tech 注意：`utils/profile.ts` 是为可测性抽取的辅助函数 · 非过度重构 · 派单档 F 项明确建议此路径
- ⚠️ login/index.spec.ts 未新建 · 因 mock Page()/wx 全局复杂度高 · mapError 集成覆盖由 G9 grep 反向断言保障 · 完整 spec 可留 P2 follow-up

## §5 风险 / 已知未知

- **hasProfile 边界**（P1-1 MVP 接受）：用户真名 = '微信用户' 时误显示"完善资料"入口 · Sprint-3 Epic-D 改用 has_completed_profile 后消失
- **双端 defaults 手工对齐**（P1-2 G7 闸门兜底）：CI 无自动化 · G7 grep + defaults.test.ts 构成防漂移保障
- **mapError action 字段暂不消费**（P2-4 dispatch 明确）：Sprint-3 用户体验扩展时统一接通
