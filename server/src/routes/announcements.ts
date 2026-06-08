/**
 * Costra · Server · /announcements 路由
 *
 * 契约：
 *   - GET  /announcements        → 200 Announcement[]（活跃公告列表 + is_read）
 *   - POST /announcements/:id/read → 204 标记已读（幂等）
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as announcementRepo from '../repositories/announcementRepo.js';

interface JwtPayload { sub: string; iat: number; exp: number }

async function parseUserId(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  return user.sub;
}

interface AnnouncementView {
  id: string;
  title: string;
  content: string;
  published_at: string;
  is_read: boolean;
}

function toView(a: announcementRepo.AnnouncementWithRead): AnnouncementView {
  return {
    id: a.id,
    title: a.title,
    content: a.content,
    published_at: a.published_at.toISOString(),
    is_read: a.is_read,
  };
}

export async function registerAnnouncementsRoutes(app: FastifyInstance): Promise<void> {

  // GET /announcements
  app.get('/announcements', async (req, reply) => {
    const userId = await parseUserId(req);
    const list = await announcementRepo.listActive(userId);
    reply.code(200).send(list.map(toView));
  });

  // POST /announcements/:id/read
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.post<{ Params: { id: string } }>(
    '/announcements/:id/read',
    async (req, reply) => {
      const userId = await parseUserId(req);
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'invalid announcement id' });
      }
      await announcementRepo.markRead(userId, id);
      reply.code(204).send();
    },
  );
}
