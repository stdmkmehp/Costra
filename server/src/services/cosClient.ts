/**
 * Costra · Server · 腾讯云 COS 客户端（一期 · 导入导出产物对象存储）
 *
 * 事实源：docs/design/cos-offload-phase1-import-export.md v0.2 §4/§5.2 · infra/cos-setup.md
 *
 * 关键事实：
 *   - 惰性单例（对齐 getPool()/getRedis() 范式）：首次 getCosClient() 才读环境变量建实例；
 *   - 环境变量（/data/conf/server.env · 两机各一套）：
 *       COS_SECRET_ID / COS_SECRET_KEY / COS_REGION=ap-shanghai /
 *       COS_BUCKET_EXPORTS=costra-{prod,staging}-cos-1309318695 / COS_DOWNLOAD_BASE=https://cos[.stg].costra.cloud；
 *   - 预签名 SignHost：getObjectUrl 的 Domain 传 COS_DOWNLOAD_BASE —— SDK 从最终 URL
 *     提取 host 作 SignHost（sdk/base.js getSignHost），签名域名与访问域名一致，否则 403；
 *   - 桶为私有读写 ⇒ 下载一律 presignGet 短时效 URL（Expires=300s · §4.0 决策）；
 *   - CAM 最小权限含 HeadObject 但无 ListBucket ⇒ 「按前缀清场」用分片编号连续探测
 *     （headObject 1..N 至首个 404）实现，见 entryExport.removeJobArtifacts；
 *   - 单测替身：__setCosForTests(fake) 注入内存替身（对齐 setExportRootForTests 范式），
 *     测试环境不设 COS_* 环境变量，未注入替身即抛错（防误连真实 COS）。
 */

import COS from 'cos-nodejs-sdk-v5';
import { appEnv } from '../config/env.js';

/** 预签名 URL 时效（§4.0 决策 · 每分片单独签发 · 失效由客户端重调下载路由换新） */
export const PRESIGN_EXPIRES_SECONDS = 300;

/** COS 对象存储最小能力面（worker 写/读/删 + 路由签发 + 前缀清场探测） */
export interface CosObjectStore {
  /** 覆盖写（同 key 重试直接覆盖 · putObject 原子语义） */
  putObject(key: string, body: Buffer): Promise<void>;
  /** 读回整个对象（导入隐私产物 .rows.ndjson.gz · 一次性内存消费） */
  getObject(key: string): Promise<Buffer>;
  /** 对象存在性探测（前缀清场用 · 404 ⇒ false，其余错误抛出） */
  headObject(key: string): Promise<boolean>;
  /** 批量删除（空数组 no-op · 单键走 deleteObject · >1000 自动分批） */
  deleteObjects(keys: string[]): Promise<void>;
  /** 签发 GET 预签名 URL（Domain=COS_DOWNLOAD_BASE · https） */
  presignGet(key: string, expiresSec: number): Promise<string>;
}

interface CosEnvConfig {
  secretId: string;
  secretKey: string;
  region: string;
  bucket: string;
  downloadBase: string;
}

function readEnvConfig(): CosEnvConfig {
  // 统一走 appEnv() 配置出口（运行时严禁直接读 process.env · env.ts 原则 1）；
  // COS_* 为可选字段（测试环境无配置），缺失在首次使用 COS 的此刻才报错（惰性失败）。
  const env = appEnv();
  const missing: string[] = [];
  if (!env.cosSecretId) missing.push('COS_SECRET_ID');
  if (!env.cosSecretKey) missing.push('COS_SECRET_KEY');
  if (!env.cosRegion) missing.push('COS_REGION');
  if (!env.cosBucketExports) missing.push('COS_BUCKET_EXPORTS');
  if (!env.cosDownloadBase) missing.push('COS_DOWNLOAD_BASE');
  if (missing.length > 0) {
    throw new Error(`[cosClient] missing env: ${missing.join(', ')}`);
  }
  return {
    secretId: env.cosSecretId!,
    secretKey: env.cosSecretKey!,
    region: env.cosRegion!,
    bucket: env.cosBucketExports!,
    downloadBase: env.cosDownloadBase!.replace(/\/+$/, ''),
  };
}

/** SDK 回调错误形态（err.error.Code/Message + err.statusCode） */
interface SdkError {
  statusCode?: number;
  error?: { Code?: string; Message?: string };
  message?: string;
}

class TencentCosObjectStore implements CosObjectStore {
  private readonly cos: COS;
  private readonly region: string;
  private readonly bucket: string;
  private readonly downloadBase: string;

  constructor(config: CosEnvConfig) {
    this.cos = new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
    this.region = config.region;
    this.bucket = config.bucket;
    this.downloadBase = config.downloadBase;
  }

  putObject(key: string, body: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.cos.putObject(
        { Bucket: this.bucket, Region: this.region, Key: key, Body: body },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  getObject(key: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.cos.getObject({ Bucket: this.bucket, Region: this.region, Key: key }, (err, data) => {
        if (err) return reject(err);
        resolve(data.Body as Buffer);
      });
    });
  }

  headObject(key: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.cos.headObject({ Bucket: this.bucket, Region: this.region, Key: key }, (err) => {
        if (!err) return resolve(true);
        if ((err as SdkError).statusCode === 404) return resolve(false);
        reject(err);
      });
    });
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000); // deleteMultipleObject 单批上限 1000
      if (batch.length === 1) {
        await new Promise<void>((resolve, reject) => {
          this.cos.deleteObject(
            { Bucket: this.bucket, Region: this.region, Key: batch[0]! },
            (err) => (err ? reject(err) : resolve()),
          );
        });
      } else if (batch.length > 1) {
        await new Promise<void>((resolve, reject) => {
          this.cos.deleteMultipleObject(
            { Bucket: this.bucket, Region: this.region, Objects: batch.map((Key) => ({ Key })) },
            (err) => (err ? reject(err) : resolve()),
          );
        });
      }
    }
  }

  presignGet(key: string, expiresSec: number): Promise<string> {
    // Domain 传自定义下载域名（含 https:// 前缀 SDK 原样保留）⇒ URL 与 SignHost 同域名
    return new Promise((resolve, reject) => {
      this.cos.getObjectUrl(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Sign: true,
          Method: 'GET',
          Expires: expiresSec,
          Domain: this.downloadBase,
        },
        (err, data) => (err ? reject(err) : resolve(data.Url)),
      );
    });
  }
}

// ==============================================================================
// 惰性单例 + 测试替身
// ==============================================================================

let instance: CosObjectStore | null = null;

export function getCosClient(): CosObjectStore {
  if (instance === null) {
    instance = new TencentCosObjectStore(readEnvConfig());
  }
  return instance;
}

/** 测试专用：注入内存替身（须在首个 COS 调用前 · 测试环境不应触达真实 COS） */
export function __setCosForTests(fake: CosObjectStore): void {
  instance = fake;
}

/** 测试专用：还原（下次 getCosClient() 重新从环境变量建实例） */
export function __resetCosForTests(): void {
  instance = null;
}
