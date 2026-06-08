# COSTRA-113 Human-Review 终审 · 最终结论

- **终止时间**：2026-04-24 12:54+08:00
- **终止原因**：`APPROVED`（Human 终审一次过 · 零异议）
- **Review 档位**：D-013 **T1 准入 Review**（搭车新产出 · 无 AI-Review 前置 · 仅 Human 终审）
- **触发指令**：`approve:COSTRA-113`（Human · 2026-04-24 12:54）

---

## 卡定位

- **标题**：`server/src/config/subject.ts` + `.env.production.example` 补 SUBJECT 段
- **Owner**：Backend-Agent
- **性质**：搭车产出（无独立 dispatch）· **搭乘母卡**：COSTRA-100（G3-gaps-plus 补齐）
- **来源决策**：D-008《主体策略 · 个人先行 · 公司兼容》
- **估点**：1 点（Sprint-1）
- **依赖**：D-008 / COSTRA-100
- **交付时间**：2026-04-23 17:50（随 COSTRA-100 §服务端骨架 G3 合并交付）

---

## 交付物清单

| # | 路径 | 类型 | 要点 |
|---|---|---|---|
| 1 | `server/src/config/subject.ts` | 源码（94 行） | 主体配置加载器：类型定义 + `loadSubjectConfig()` + 启动期冻结单例 + `renderSubjectTemplate()` 模板占位 |
| 2 | `server/.env.production.example` | 环境模板（62 行） | SUBJECT 段双模板（模板 A 个人 / 模板 B 公司注释），D-008 切换剧本内联在注释里 |

---

## Human 终审要点逐条核对

### ✅ 1. D-008 策略对齐
- 个人主体先行（`SUBJECT_TYPE=individual`）· 公司主体兼容（模板 B 完整注释保留）
- 切换剧本一致：`cp .env.production.example .env.production` → 二选一填充 → 重启
- 与 `.team/decisions/D-008-subject-individual-first-with-corporate-compat.md` 精神一致

### ✅ 2. 反硬编码纪律
- `subject.ts:5-14` 注释明示"业务层严禁硬编码主体名 / ICP 号 / 联系方式"
- 消费方清单明确：SSR 隐私指引 / 审计日志 `data_controller` / 订阅消息文案
- 下游清扫卡 COSTRA-112（MiniApp）有对应登记

### ✅ 3. 类型安全与启动期冻结
- `SubjectType` 枚举硬约束 `'individual' | 'corporate'`，非法值启动即 throw
- `Object.freeze(cfg)` 运行时不可变 · 禁止运行时变更（注释 L9 明示）
- `required()` 辅助在生产缺字段时启动失败，由上层 bootstrapper 捕获（配合 COSTRA-114 bootstrap）

### ✅ 4. 测试可注入性
- `loadSubjectConfig(env)` 支持自定义 env 注入，便于单测隔离
- 模板渲染 `renderSubjectTemplate(template, cfg)` 第二参可注入，测试友好

### ✅ 5. 环境模板的切换友好度
- 模板 A / 模板 B 并列 · 行内注释含"身份证姓名""蜀ICP 备案示例格式"
- `SUBJECT_DATA_CONTROLLER` 预留独立键（便于策略差异化，虽默认 = `SUBJECT_NAME`）
- 与 `docs/ops/subject-compat-matrix.md`（COSTRA-111 Owner）命名口径一致

### ✅ 6. 模板占位规约
- `{{SUBJECT_NAME}}` / `{{SUBJECT_ICP}}` / `{{SUBJECT_CONTACT_EMAIL}}` 等 7 个占位符齐全
- 与 COSTRA-109 隐私指引辅助清单、COSTRA-110 订阅消息文案草稿占位规约一致

---

## 残余与 Follow-up

- **P0/P1/P2 残余**：0 / 0 / 0
- **Follow-up**：**无**
- **下游依赖卡**：
  - COSTRA-112（MiniApp · `miniprogram/config/subject.ts` + 清扫）· 可并行启动（不阻塞）
  - COSTRA-111（PM · `docs/ops/subject-compat-matrix.md`）· 已在 Doing · 不阻塞
  - COSTRA-114（DevOps · 开发服务器 bootstrap）· `.env.production` 实填由该卡覆盖

---

## 流程学习点

1. **搭车卡的轻量处置**：COSTRA-113 作为 COSTRA-100 搭车产出，无独立 dispatch / AI-Review，仅走 Human T1 终审（D-013）— **流程成本 ≈ 1 次读代码 + 1 次签字**，验证 D-013 分级规约在"搭车产出"场景下的正确性。
2. **D-013 T1 档位适用性**：新增/修改的配置加载器属"准入 Review"——一旦放行即进生产路径，因此保留 Human 终审。自动关闭（T3/T4）不适用。
3. **实装与交付时间差**：代码 04-23 17:50 落地，终审 04-24 12:54（≈ 19 小时）— Human 审批队列深度可接受，无需进一步优化通道。

---

## 归档去向

- `board.md`：从 `[R] Human-Review · Sprint-1 主线` 迁出 → `Done · Sprint-1`
- `STATE`：从"🟠 中优先级待触发清单"移除；"进行中"列表删 COSTRA-113 行；Human-Review 队列数归零（该档位）
- `daily/2026-04-24.md`：今日待触发 🟠 中段移除
- Human-Review 队列：Sprint-1 主线从 1 → **0**（仅剩 COSTRA-101 在 AI-Review 自动循环）

---

**FINAL · COSTRA-113 APPROVED · 2026-04-24 12:54 · Human terminal sign-off**
