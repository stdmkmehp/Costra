// services/gmApi.ts · GM 工具 API（仅 users.is_gm 用户可用 · 服务端 requireGm 实时查库鉴权）
// 事实源: docs/ops/gm-impersonate-design.md · server/api/openapi.yaml /gm/users
// impersonate 请求内聚在 services/auth.ts gmLoginAs（随后必须走 applyLoginResponse 登录管道，
// 且需避免 auth → gmApi → request → auth 循环依赖，故不放入本模块）。
import { request } from './request';

/** GM 活跃榜条目（近 7 天活跃 · 服务端不返回 openid · D3） */
export interface GmActiveUserItem {
  id: string;
  id_short: string;
  nickname: string;
  avatar_url: string | null;
  created_at: string;
  /** 近 7 天 entries 写入数 */
  entry_count_7d: number;
  /** 最后一笔 entries 写入时间（ISO） */
  last_active_at: string;
}

/** GM 注册榜条目 */
export interface GmRecentUserItem {
  id: string;
  id_short: string;
  nickname: string;
  avatar_url: string | null;
  created_at: string;
}

/**
 * GM 用户双榜单（各 Top 200 · 服务端整榜 Redis 缓存 30min）
 * 无分页参数：一次全量下发，分页由页面本地切片。
 */
export interface GmUserLists {
  active: GmActiveUserItem[];
  recent: GmRecentUserItem[];
}

/** GM 用户双榜单：active = 近7天活跃（entry_count_7d DESC），recent = 最近注册（created_at DESC） */
export async function listGmUsers(): Promise<GmUserLists> {
  return request<GmUserLists>({
    method: 'GET',
    path: '/gm/users',
  });
}
