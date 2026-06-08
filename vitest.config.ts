// vitest.config.ts · 单测入口
// 卡号: COSTRA-102 · D2.10
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@services': path.resolve(__dirname, 'miniprogram/services'),
      '@utils': path.resolve(__dirname, 'miniprogram/utils'),
      '@tokens': path.resolve(__dirname, 'miniprogram/tokens'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // 单测纯逻辑层 · 不模拟 wx 运行时（dispatch §1.3 约束）
    include: [
      'miniprogram/**/*.spec.ts',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'miniprogram/services/storage.ts',  // 依赖 wx 全局，骨架期不测
    ],
    // 避免 wx 全局缺失阻塞 · 单测代码不应 import storage.ts 入口
    testTimeout: 10_000,
  },
});
