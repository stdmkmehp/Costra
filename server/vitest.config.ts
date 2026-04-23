/**
 * Costra · Server · Vitest 配置
 *
 * 卡号：COSTRA-101 · 事实源：dispatch §4 test 配置要求
 *
 * 约定：
 *   - setup.ts 每个用例前后做：pg-mem 初始化 / Redis mock 注入 / wxFetch mock / env 单例 reset
 *   - globals:true 允许用例直接用 describe / it / expect 而无需 import
 *   - coverage 阈值在 COSTRA-101 不强制卡线（Sprint-2 再拉高），只打开输出
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'], // 进程入口无法在单测跑
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
