/**
 * Costra · Server · ICP 备案信息（Single Source of Truth）
 *
 * 卡号：COSTRA-ICP（备案下证 · 2026-05-13）
 *
 * 职责：
 *   - 唯一存放 ICP 备案号与查询入口；业务层与文档层（README / OpenAPI）禁止散落硬编码。
 *   - 被 `routes/healthz.ts`（健康检查附带）与 `routes/legal.ts`（GET /v1/legal/icp）消费。
 *
 * 注意：
 *   - 与 `config/subject.ts` 的 SUBJECT_ICP_NUMBER 区分：
 *     · subject.ts 关注"主体身份"（隐私指引 / 协议占位 / audit 控制者标识）；
 *     · icp.ts 关注"备案信息"（工信部公示口径，含查询入口与下证日期）。
 *   - 备案号字符串严格使用工信部下证文本，请勿改写为 ASCII 数字 / 半角破折号。
 */

export interface IcpInfo {
  /** 后端服务备案号（域名 costra.cloud 主体备案） */
  service: string;
  /** 小程序备案号 */
  miniapp: string;
  /** 备案主体所在地（行政区简称，与工信部公示一致） */
  subject: string;
  /** 下证日期（ISO date · YYYY-MM-DD） */
  filedAt: string;
  /** 工信部官方查询入口（腾讯云规范要求底部链接到此） */
  verifyUrl: string;
}

export const ICP_INFO: Readonly<IcpInfo> = Object.freeze({
  service: '沪ICP备2026017253号-2',
  miniapp: '沪ICP备2026017253号-1X',
  subject: '上海',
  filedAt: '2026-05-13',
  verifyUrl: 'https://beian.miit.gov.cn/',
});
