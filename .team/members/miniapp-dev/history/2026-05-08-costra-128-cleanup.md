# COSTRA-128 · FU-LAUNCH 族治理收尾清洗

## §1 任务描述

COSTRA-128 · chore · P3 · 1 点。FU-LAUNCH 族 124~127 治理收尾，对源码注释和文档进行简洁清洗。

## §2 产出

6 项 A~F 全完成：

| 项 | 文件 | 改动 |
|---|---|---|
| A | `miniprogram/services/storage.ts` | 顶部注释 18 行→8 行（删 v1/v2/v3 历史叙事 + 修正不变量 #4 措辞）；ensureVersion 注释 13 行→5 行（删历史演进） |
| B | `miniprogram/pages/home/index.ts` | 删 onLoad 第 2 行 v3 残留注释（与 onShow 实装矛盾） |
| C | `home/index.ts` + `mine/index.ts` | onLoad 上方各加 1 行"冗余兜底"标注 |
| D | `miniprogram/app.ts` | bootstrap reLaunch 上方加 1 行注释 |
| E | `docs/devops/libversion-upgrade.md` | §3.4 删 ⚠️v4/v5 长块 → 换 v5 定稿 1 行 + 4 行版本演进表 |
| F | `.team/members/miniapp-dev/state.md` | §6 FU-LAUNCH 长篇描述 → 1 行指针 |

## §3 关键决策

- "简洁"原则：删比加多（-x ≥ +x），不写"清洗背景"长篇，不保留历史叙事
- state.md §6 其他 FU（Card-Review FU 等）保留（与 FU-LAUNCH 无关）

## §4 遗留

无。

## §5 state.md diff

- §2 active tasks：未增（新卡不加入 active，chore 不 track）
- §3 交付历史索引：未增（本卡仅文档清洗，不新建 history 条目，直接在 §7 时间戳记录）
- §6：长篇 FU-LAUNCH 描述 → 1 行指针
- §7 时间戳：+1 条（2026-05-08T18:45:00）