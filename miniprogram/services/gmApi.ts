// services/gmApi.ts · GM 工具 API（仅 users.is_gm 用户可用 · 服务端 requireGm 实时查库鉴权）
// 事实源: docs/ops/gm-impersonate-design.md · server/api/openapi.yaml /gm/users
// impersonate 请求内聚在 services/auth.ts gmLoginAs（随后必须走 applyLoginResponse 登录管道，
// 且需避免 auth → gmApi → request → auth 循环依赖，故不放入本模块）。
import { request } from './request';

/** GM 用户列表项（服务端不返回 openid · D3） */
export interface GmUserItem {
  id: string;
  id_short: string;
  nickname: string;
  avatar_url: string | null;
  created_at: string;
}

export interface GmUsersPage {
  items: GmUserItem[];
  page: number;
  page_size: number;
  has_more: boolean;
}

/** GM 用户列表（created_at DESC 稳定排序 · 排除软删） */
export async function listGmUsers(page: number, pageSize = 20): Promise<GmUsersPage> {
  return request<GmUsersPage>({
    method: 'GET',
    path: '/gm/users',
    query: { page, page_size: pageSize },
  });
}
