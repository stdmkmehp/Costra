/**
 * Costra · Server · 腾讯云 COS 客户端（多桶版 · 一期导入导出产物 + 二期用户头像）
 *
 * 事实源：docs/design/cos-offload-phase1-import-export.md v0.2 §4/§5.2 · infra/cos-setup.md
 *         docs/design/cos-offload-phase2-avatar.md v1.6 §7.1（多桶化）
 *
 * 关键事实：
 *   - 桶维度惰性单例（对齐 getPool()/getRedis() 范式）：首次 getCosClient(bucket) 才读
 *     环境变量建该桶 store；store 一经创建进程内复用（绝非每请求新建）。
 *   - 两个桶：
 *       exports  一期私有产物桶（costra-{prod,staging}-cos-1309318695 · 30 天生命周期）
 *                私有读写 ⇒ 下载一律 presignGet 短时效 URL（Expires=300s · 一期 §4.0 决策）；
 *       avatars  二期公有读头像桶（costra-{prod,staging}-avatar-1309318695 · 禁止生命周期）
 *                公有读私有写 ⇒ 公开 URL 走 objectUrl() 不签名（二期 §6.2 决策 D3）。
 *   - 环境变量（/data/conf/server.env · 两机各一套）：
 *       共用      COS_SECRET_ID / COS_SECRET_KEY / COS_REGION=ap-shanghai
 *       exports   COS_BUCKET_EXPORTS / COS_DOWNLOAD_BASE=https://cos[.stg].costra.cloud
 *       avatars   COS_BUCKET_AVATARS / COS_AVATAR_BASE=https://img[.stg].costra.cloud
 *   - 预签名 SignHost：getObjectUrl 的 Domain 传该桶 base —— SDK 从最终 URL
 *     提取 host 作 SignHost（sdk/base.js getSignHost），签名域名与访问域名一致，否则 403；
 *   - CAM 最小权限含 HeadObject 但无 ListBucket ⇒ 「按前缀清场」用分片编号连续探测
 *     （headObject 1..N 至首个 404）实现，见 entryExport.removeJobArtifacts；
 *   - 超时按桶配置（二期 §7.1-6）：SDK 的 Timeout 是**构造级**参数（无单次请求级入口，
 *     sdk/cos.js 默认 0=不超时），故无法"一个 SDK 实例两桶各一套超时"——SDK 实例按桶各一。
 *     avatars=5000ms：头像 ~9KB 经 /v1/upload/avatar（nginx proxy_read_timeout 10s），
 *     必须先于 nginx 失败，否则用户先收到 504 HTML（破坏 JSON 错误契约）；
 *     exports 保持 SDK 默认（不设）：分片 ~900KB 走 worker 内部调用（不经 nginx），
 *     2Mbps 出口下单分片传输就需数秒，5s 反而误判超时。
 *   - 单测替身：__setCosForTests(bucket, fake) 按桶注入内存替身（对齐 setExportRootForTests
 *     范式），测试环境不设 COS_* 环境变量，未注入替身即抛错（防误连真实 COS）。
 */

import COS from 'cos-nodejs-sdk-v5';
import { appEnv } from '../config/env.js';

/** 预签名 URL 时效（一期 §4.0 决策 · 每分片单独签发 · 失效由客户端重调下载路由换新） */
export const PRESIGN_EXPIRES_SECONDS = 300;

/** 头像桶请求超时（二期 §7.1-6 · 须先于 nginx proxy_read_timeout 10s 失败） */
export const AVATARS_TIMEOUT_MS = 5000;

/** 头像对象 Cache-Control（二期 §5.3 · 配合 ?v= 版本化 URL ⇒ 重复加载零请求） */
export const AVATAR_CACHE_CONTROL = 'public, max-age=31536000';

/** 桶名（'exports' 保持一期原名 · 调用点显式传桶名、不给默认值，避免隐式耦合） */
export type CosBucketName = 'exports' | 'avatars';

/** putObject 可选对象元数据（头像桶 ContentType 是去后缀后类型信息的唯一载体 · 二期 D2） */
export interface PutObjectOptions {
  contentType?: string;
  cacheControl?: string;
}

/** COS 对象存储最小能力面（worker 写/读/删 + 路由签发 + 前缀清场探测 + 公开 URL 出口） */
export interface CosObjectStore {
  /** 覆盖写（同 key 重试直接覆盖 · putObject 原子语义） */
  putObject(key: string, body: Buffer, opts?: PutObjectOptions): Promise<void>;
  /** 读回整个对象（导入隐私产物 .rows.ndjson.gz · 一次性内存消费） */
  getObject(key: string): Promise<Buffer>;
  /** 对象存在性探测（前缀清场用 · 404 ⇒ false，其余错误抛出） */
  headObject(key: string): Promise<boolean>;
  /** 批量删除（空数组 no-op · 单键走 deleteObject · >1000 自动分批） */
  deleteObjects(keys: string[]): Promise<void>;
  /** 签发 GET 预签名 URL（Domain=该桶 base · https） */
  presignGet(key: string, expiresSec: number): Promise<string>;
  /** 不签名的公开对象 URL（基于该桶 base 域名 · 公有读桶用 · 公开 URL 唯一出口） */
  objectUrl(key: string): string;
}

interface CosEnvConfig {
  secretId: string;
  secretKey: string;
  region: string;
  bucket: string;
  /** 该桶 URL base（exports=预签名下载域名 SignHost · avatars=公有读域名 objectUrl） */
  baseUrl: string;
  /** 请求超时 ms（undefined = 不设 · SDK 默认 0 不超时；按桶配置见文件头） */
  timeoutMs: number | undefined;
}

function readEnvConfig(bucket: CosBucketName): CosEnvConfig {
  // 统一走 appEnv() 配置出口（运行时严禁直接读 process.env · env.ts 原则 1）；
  // COS_* 为可选字段（测试环境无配置），缺失在首次使用 COS 的此刻才报错（惰性失败）。
  const env = appEnv();
  const missing: string[] = [];
  if (!env.cosSecretId) missing.push('COS_SECRET_ID');
  if (!env.cosSecretKey) missing.push('COS_SECRET_KEY');
  if (!env.cosRegion) missing.push('COS_REGION');

  let bucketName: string | undefined;
  let base: string | undefined;
  let timeoutMs: number | undefined;
  if (bucket === 'exports') {
    bucketName = env.cosBucketExports;
    base = env.cosDownloadBase;
    if (!bucketName) missing.push('COS_BUCKET_EXPORTS');
    if (!base) missing.push('COS_DOWNLOAD_BASE');
  } else {
    bucketName = env.cosBucketAvatars;
    base = env.cosAvatarBase;
    timeoutMs = AVATARS_TIMEOUT_MS;
    if (!bucketName) missing.push('COS_BUCKET_AVATARS');
    if (!base) missing.push('COS_AVATAR_BASE');
  }
  if (missing.length > 0) {
    throw new Error(`[cosClient] missing env (${bucket}): ${missing.join(', ')}`);
  }
  return {
    secretId: env.cosSecretId!,
    secretKey: env.cosSecretKey!,
    region: env.cosRegion!,
    bucket: bucketName!,
    baseUrl: base!.replace(/\/+$/, ''),
    timeoutMs,
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
  private readonly baseUrl: string;

  constructor(config: CosEnvConfig) {
    // Timeout 是构造级参数（无单次请求级入口）⇒ 按桶各建一个 SDK 实例（见文件头）；
    // undefined 时不传该键，保持 SDK 默认（Timeout=0 不超时 · 对齐一期行为）。
    this.cos = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
      ...(config.timeoutMs !== undefined ? { Timeout: config.timeoutMs } : {}),
    });
    this.region = config.region;
    this.bucket = config.bucket;
    this.baseUrl = config.baseUrl;
  }

  putObject(key: string, body: Buffer, opts?: PutObjectOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Body: body,
          ...(opts?.contentType !== undefined ? { ContentType: opts.contentType } : {}),
          ...(opts?.cacheControl !== undefined ? { CacheControl: opts.cacheControl } : {}),
        },
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
    // Domain 传该桶自定义域名（含 https:// 前缀 SDK 原样保留）⇒ URL 与 SignHost 同域名
    return new Promise((resolve, reject) => {
      this.cos.getObjectUrl(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Sign: true,
          Method: 'GET',
          Expires: expiresSec,
          Domain: this.baseUrl,
        },
        (err, data) => (err ? reject(err) : resolve(data.Url)),
      );
    });
  }

  objectUrl(key: string): string {
    // 与 presignGet 共用同一 baseUrl ⇒ 域名来源单一（二期 §7.1-3 · 路由不再拼 env 域名）
    return `${this.baseUrl}/${key}`;
  }
}

// ==============================================================================
// 桶维度惰性单例 + 测试替身
// ==============================================================================

const instances = new Map<CosBucketName, CosObjectStore>();

export function getCosClient(bucket: CosBucketName): CosObjectStore {
  let instance = instances.get(bucket);
  if (instance === undefined) {
    instance = new TencentCosObjectStore(readEnvConfig(bucket));
    instances.set(bucket, instance);
  }
  return instance;
}

/** 测试专用：按桶注入内存替身（须在首个 COS 调用前 · 测试环境不应触达真实 COS） */
export function __setCosForTests(bucket: CosBucketName, fake: CosObjectStore): void {
  instances.set(bucket, fake);
}

/** 测试专用：清空全部桶实例（下次 getCosClient(bucket) 重新从环境变量建实例） */
export function __resetCosForTests(): void {
  instances.clear();
}
