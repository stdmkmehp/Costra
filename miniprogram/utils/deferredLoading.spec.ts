// utils/deferredLoading.spec.ts · "加载中"延迟显示工具单测
// Refs: utils/deferredLoading.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LOADING_DELAY_MS, scheduleDeferredLoading } from './deferredLoading';

describe('utils/deferredLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('LOADING_DELAY_MS · 阈值常量', () => {
    it('阈值定为 275ms（吞掉乐观+典型 RTT 路径，慢路径下推迟显示 75ms 内可忽略）', () => {
      expect(LOADING_DELAY_MS).toBe(275);
    });
  });

  describe('scheduleDeferredLoading · 基础时序', () => {
    it('未到点不触发 onFire；fired 为 false', () => {
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire);

      vi.advanceTimersByTime(LOADING_DELAY_MS - 1);
      expect(onFire).not.toHaveBeenCalled();
      expect(handle.fired).toBe(false);
    });

    it('到点触发 onFire；fired 翻为 true', () => {
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire);

      vi.advanceTimersByTime(LOADING_DELAY_MS);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(handle.fired).toBe(true);
    });

    it('支持自定义 delayMs（用于单测注入或场景化阈值）', () => {
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire, 50);

      vi.advanceTimersByTime(49);
      expect(onFire).not.toHaveBeenCalled();
      expect(handle.fired).toBe(false);

      vi.advanceTimersByTime(1);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(handle.fired).toBe(true);
    });
  });

  describe('scheduleDeferredLoading · cancel 行为', () => {
    it('到点前 cancel：onFire 永不触发；fired 维持 false（"loading 从未显示过"语义）', () => {
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire);

      vi.advanceTimersByTime(100);
      handle.cancel();
      vi.advanceTimersByTime(LOADING_DELAY_MS * 2);

      expect(onFire).not.toHaveBeenCalled();
      expect(handle.fired).toBe(false);
    });

    it('到点后 cancel：fired 保持 true（调用方据此写 loading:false 关闭显示）', () => {
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire);

      vi.advanceTimersByTime(LOADING_DELAY_MS);
      expect(handle.fired).toBe(true);

      handle.cancel();
      expect(handle.fired).toBe(true);
    });

    it('cancel 幂等：多次调用不抛错、不再触发 onFire', () => {
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire);

      handle.cancel();
      handle.cancel();
      handle.cancel();

      vi.advanceTimersByTime(LOADING_DELAY_MS * 2);
      expect(onFire).not.toHaveBeenCalled();
    });
  });

  describe('scheduleDeferredLoading · 多句柄独立性', () => {
    it('多个句柄相互独立：cancel 一个不影响其他', () => {
      const fireA = vi.fn();
      const fireB = vi.fn();
      const handleA = scheduleDeferredLoading(fireA);
      const handleB = scheduleDeferredLoading(fireB);

      handleA.cancel();
      vi.advanceTimersByTime(LOADING_DELAY_MS);

      expect(fireA).not.toHaveBeenCalled();
      expect(fireB).toHaveBeenCalledTimes(1);
      expect(handleA.fired).toBe(false);
      expect(handleB.fired).toBe(true);
    });
  });

  describe('scheduleDeferredLoading · 并发场景（保护 INV-2/INV-3）', () => {
    it('快路径模拟：onFire 还未触发就 settle → 全程 fired=false', () => {
      // 模拟统计页"快路径"：用户点击 → 数据 100ms 就回来
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire);

      // 模拟 100ms 后数据返回
      vi.advanceTimersByTime(100);
      handle.cancel();

      // 即使后续时间继续推进，loading 也不会显示
      vi.advanceTimersByTime(LOADING_DELAY_MS * 2);
      expect(onFire).not.toHaveBeenCalled();
      expect(handle.fired).toBe(false);
    });

    it('慢路径模拟：到点后才 settle → fired=true，调用方按需写 loading:false', () => {
      // 模拟统计页"慢路径"：用户点击 → 600ms 才回来
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire);

      // 275ms 时 loading 显示
      vi.advanceTimersByTime(LOADING_DELAY_MS);
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(handle.fired).toBe(true);

      // 数据 600ms 时返回
      vi.advanceTimersByTime(325);
      handle.cancel();
      expect(handle.fired).toBe(true);
    });

    it('用户主动收起：未 fire 即 cancel → loading 永不出现', () => {
      // 模拟用户在 100ms 时再次点击收起
      const onFire = vi.fn();
      const handle = scheduleDeferredLoading(onFire);

      vi.advanceTimersByTime(100);
      handle.cancel();

      vi.advanceTimersByTime(LOADING_DELAY_MS * 2);
      expect(onFire).not.toHaveBeenCalled();
      expect(handle.fired).toBe(false);
    });
  });
});
