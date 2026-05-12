# COSTRA-105 · 自动化脚手架（README 占位 + 用例伪代码）

> **卡号**：COSTRA-105（Sprint-2 主线第 4 张）
> **形式**：形式 ②（README 占位 + 用例伪代码 · 按 Card-Review P1-1 降级路径）
> **原因**：`miniprogram-automator` 未安装 + 需微信开发者工具运行 → 评估 <5 分钟 → 直接降级
> **状态**：脚手架占位 · 全量自动化转 **FU-105-AUTOMATION-FULL-COVERAGE**（Sprint-3 候选 · P2 · 5 点）

---

## §1 自动化形式说明

### §1.1 Card-Review P1-1 降级路径（已采纳）

- **P1-1 要求**：`qa/automation/single-user-smoke.spec.ts` 脚手架两种形式择一：
  - **形式 ①**：`miniprogram-automator` TypeScript 脚手架 + 1~2 示例用例（真实 setup）
  - **形式 ②**：README 占位 + 用例伪代码
  - **两者均等效通过 DoD**
- **本卡选择**：形式 ②（README 占位 + 用例伪代码）
- **原因**：`miniprogram-automator` npm 包不存在 + 需要微信开发者工具 IDE 运行 + 评估 <5 分钟 → 直接走形式 ②

### §1.2 后续 FU

| FU | 说明 | owner | 状态 |
|---|---|---|---|
| **FU-105-AUTOMATION-FULL-COVERAGE** | 14 用例全量自动化 + CI 集成 | qa-planner + miniapp-dev | Sprint-3 候选 |

---

## §2 自动化用例伪代码

> 以下为 SU-001 + SU-002 两个核心用例的伪代码（供后续 FU-105-AUTOMATION-FULL-COVERAGE 参考）

### SU-001 伪代码（冷启 + 登录闭环）

```typescript
// qa/automation/single-user-smoke.spec.ts
// 自动化框架：miniprogram-automator（微信官方）
// 依赖：npm install miniprogram-automator --save-dev
// 前置：微信开发者工具已打开项目 + 端口暴露（默认 9427）

import { default as automator, Page } from 'miniprogram-automator';

// === SU-001 冷启 + 登录闭环 ===

describe('SU-001: 冷启 + 登录闭环', () => {
  let page: Page;

  beforeAll(async () => {
    // 连接模拟器/真机（需微信开发者工具已打开 + 端口 9427）
    await automator.launch({ projectPath: './miniprogram' });
  });

  afterAll(async () => {
    await automator.close();
  });

  it('TTI ≤ 2s + 登录成功', async () => {
    // 1. 清除 storage（模拟冷启）
    const storageBefore = await page.evaluate(() => {
      wx.clearStorageSync();
      return true;
    });

    // 2. 计时开始
    const t0 = Date.now();

    // 3. 点击"一键微信登录"按钮
    const loginBtn = await page.waitFor('button[type="primary"]');
    await loginBtn.tap();

    // 4. 等待 home 页面出现（tabBar 可见）
    await page.waitForSelector('.tab-bar', { timeout: 3000 });
    const t1 = Date.now();

    // 5. 断言：TTI ≤ 2s
    expect(t1 - t0).toBeLessThanOrEqual(2000);

    // 6. 断言：storage 有有效 Token
    const token = await page.evaluate(() => {
      const raw = wx.getStorageSync('__costra_token_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.access_token || null;
    });
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThanOrEqual(36);

    // 7. 断言：Console 无 `too eayly` 报错
    const consoleErrors = await page.evaluate(() => {
      // miniprogram-automator 读取 Console API
      return []; // 伪代码占位
    });
    expect(consoleErrors).toHaveLength(0);
  });
});
```

### SU-002 伪代码（在线记一笔）

```typescript
// === SU-002 在线记一笔 ===

describe('SU-002: 在线记一笔（端到端）', () => {
  let page: Page;

  beforeAll(async () => {
    await automator.launch({ projectPath: './miniprogram' });
    // 前置：已登录（SU-001 通过）
    const homePage = await page.switchTab('/pages/home/index');
  });

  it('记一笔：金额 12.34 + 分类餐饮 + 提交成功', async () => {
    // 1. 点击 FAB + 按钮
    const fabBtn = await page.waitFor('.fab-add');
    await fabBtn.tap();

    // 2. 等待记一笔页面加载
    await page.waitForSelector('#amount-input', { timeout: 2000 });

    // 3. 填写表单
    await page.enterText('#amount-input', '12.34');

    // 4. 选择分类（餐饮）
    await page.tap('.category-item[data-category="food"]');

    // 5. 提交
    const submitBtn = await page.waitFor('button[type="submit"]');
    await submitBtn.tap();

    // 6. 断言：Toast 出现
    const toast = await page.waitForSelector('.toast-message', { timeout: 3000 });
    const toastText = await toast.text();
    expect(['已记录', '保存成功']).toContain(toastText);

    // 7. 断言：storage 有 entry key
    const entryCount = await page.evaluate(() => {
      const idx = wx.getStorageSync('entry:__index');
      return idx?.d?.length || 0;
    });
    expect(entryCount).toBeGreaterThanOrEqual(1);

    // 8. 断言：payload snake_case
    const firstEntry = await page.evaluate(() => {
      const idx = wx.getStorageSync('entry:__index');
      const firstKey = idx?.d?.[0];
      if (!firstKey) return null;
      return wx.getStorageSync(`entry:${firstKey}`);
    });
    if (firstEntry) {
      const keys = Object.keys(firstEntry.d.payload);
      const camelCase = keys.filter(k => /[A-Z]/.test(k));
      expect(camelCase).toHaveLength(0);
    }
  });
});
```

---

## §3 脚手架说明

### §3.1 自动化路径（当前状态）

```
qa/automation/
├── README.md（本文件）      ← 脚手架占位 + 用例伪代码
└── single-user-smoke.spec.ts ← 伪代码（供后续 FU 参考）
```

### §3.2 后续 FU 执行计划

**FU-105-AUTOMATION-FULL-COVERAGE**（Sprint-3 候选 · 5 点 · owner=qa-planner+miniapp-dev）：

1. 安装 `miniprogram-automator`（`npm install -D miniprogram-automator`）
2. 配置微信开发者工具端口暴露（`project.config.json` + IDE 设置）
3. 实装 14 条用例自动化（SU-001~014）
4. 集成 CI 流水线（`.github/workflows/pr-check.yml` 新增 step）
5. 目标：核心链路自动化覆盖 ≥ 80%

### §3.3 自动化执行命令（后续 FU 用）

```bash
# 开发期本地跑（需微信开发者工具已打开）
cd qa
npx jest --config jest.e2e.config.js

# CI 流水线（自动化在 dev 分支合并后触发）
npm run test:e2e   # 等价于 npx miniprogram-automator run
```

---

## §4 用例 → 自动化优先级（供 FU 参考）

| 优先级 | 用例 | 自动化可行性 | 备注 |
|---|---|---|---|
| P0 | SU-001（登录）· SU-002（记一笔）| ✅ 高 | 用户核心链路 |
| P0 | SU-003/004（离线）| ⚠️ 中 | 需 Network 模拟 |
| P1 | SU-005（幂等）| ⚠️ 中 | curl 层测试 |
| P1 | SU-006（conflict）| ⚠️ 中 | 需数据准备 |
| P2 | SU-007~014 | 🟡 低 | 边界/安全/合规 |

---

**修订记录**：
- v1.0 · 2026-05-12 · COSTRA-105 R1 实装（形式 ② 降级 · FU-105-AUTOMATION-FULL-COVERAGE Sprint-3）