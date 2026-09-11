/**
 * Costra · Server · 测试用内存 COS 替身（__setCosForTests 注入）
 *
 * 事实源：docs/design/cos-offload-phase1-import-export.md v0.2 §5.4（内存替身注入方式）
 *
 * 行为与真实 COS 对齐的最小集合：
 *   - putObject 覆盖写（同 key 重试覆盖）；
 *   - getObject 缺失 ⇒ 抛 404（对齐真实 SDK 的 err.statusCode）；
 *   - headObject 存在性探测；
 *   - deleteObjects 批量删（missing key 静默忽略 · 对齐 COS 语义）；
 *   - presignGet 返回可断言的假 URL（携带 key 与 expires · 不签名）。
 *   - copy：getObject 返回内部 Buffer 副本，防调用方原地修改污染替身内容。
 */

import type { CosObjectStore } from '../../src/services/cosClient.js';

export class MemoryCosStore implements CosObjectStore {
  private readonly objects = new Map<string, Buffer>();
  /** 假 URL 前缀（断言用 · 与生产 COS_DOWNLOAD_BASE 形态一致） */
  readonly downloadBase = 'https://cos.test.local';

  putObject(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(body));
    return Promise.resolve();
  }

  getObject(key: string): Promise<Buffer> {
    const body = this.objects.get(key);
    if (body === undefined) {
      return Promise.reject(Object.assign(new Error(`NoSuchKey: ${key}`), { statusCode: 404 }));
    }
    return Promise.resolve(Buffer.from(body));
  }

  headObject(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key);
    return Promise.resolve();
  }

  presignGet(key: string, expiresSec: number): Promise<string> {
    return Promise.resolve(`${this.downloadBase}/${key}?fake-sign=1&expires=${expiresSec}`);
  }

  // ─── 断言辅助（非 CosObjectStore 接口） ───

  /** 对象是否存在 */
  has(key: string): boolean {
    return this.objects.has(key);
  }

  /** 读内部内容（断言用 · 不存在返回 undefined） */
  content(key: string): Buffer | undefined {
    const body = this.objects.get(key);
    return body === undefined ? undefined : Buffer.from(body);
  }

  /** 当前全部 key（调试用） */
  keys(): string[] {
    return [...this.objects.keys()];
  }

  /** 清空（beforeEach 用） */
  clear(): void {
    this.objects.clear();
  }
}
