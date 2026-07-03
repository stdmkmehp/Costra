-- Costra · 公告更新：正式上线 + 保留历史公测公告可见
-- 依赖：0002_announcements.sql、0005_bulletin_update.sql
-- 幂等：UPDATE 反复执行无副作用；INSERT 使用 ON CONFLICT DO NOTHING
--
-- 设计：删档公测 / 不删档公测两条历史公告均保留给用户查看，
--   故本迁移不过期任何公告，反而清空历史公告的 expires_at 使其重新可见
--   （0002 曾设 2026-07-01 过期、0005 曾将「删档公测说明」标记过期）。
--   已读记录（announcement_reads）保留，已读用户不会因此重新出现红点。

BEGIN;

-- Step 1: 恢复历史公测公告可见（清空 expires_at）
-- 覆盖「删档公测说明」与「不删档公测已开启」两条历史公告。
-- 说明：仅调整可见性（运维态），不改内容，故不动 updated_at
--   —— updated_at 语义约定为「内容级变更时间」，运维态调整不记录。
UPDATE announcements
   SET expires_at = NULL
 WHERE title IN ('删档公测说明', '不删档公测已开启')
   AND deleted_at IS NULL
   AND expires_at IS NOT NULL;

-- Step 2: 插入新公告——正式上线 + 最近主要更新
-- 使用固定 UUID + ON CONFLICT DO NOTHING，确保幂等可重跑。
INSERT INTO announcements (id, title, content, published_at, expires_at)
VALUES (
  'a2c4e6f8-0008-4a7d-b8e1-3d4e5a6b7c8f',
  'Costra 正式上线啦',
  'Costra 已于 2026 年 7 月 3 日正式上线！在此之前的不删档公测阶段，你记录的所有数据都已安全保留并延续到正式版，无需任何迁移操作，打开即可继续使用。

感谢陪伴 Costra 一路走来的每一位用户，正式版会以更稳定、更好用的姿态和大家长期同行。

以下是最近的主要更新：

分类图标全面升级
· 分类图标由单字符符号升级为矢量图标字体，共 81 个精致图标，显示更清晰、更美观
· 一级、二级分类图标持续打磨，识别度更高

新增功能
· 明细页支持长按记录唤出快捷菜单：复制、改备注、改金额、改分类、删除，一步到位
· 新增「关于 Costra」页面与「定时记账」入口

体验优化
· 切换底部标签栏、打开记账浮层更顺滑，消除了偶发的闪烁与丢失问题
· 统计的日均 / 月均更准确，切换成员、维度时数据也能及时刷新
· 分类展开顺序、数据同步与后台运行更稳定',
  now(),
  NULL
) ON CONFLICT (id) DO NOTHING;

COMMIT;
