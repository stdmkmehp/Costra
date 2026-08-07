-- Costra · 公告更新：新增资产、预算与周期记账
-- 依赖：0002_announcements.sql、0008_announcement_launch.sql
-- 幂等：INSERT 使用 ON CONFLICT DO NOTHING
--
-- 设计：本迁移新增一份公告，介绍近期上线的账本资产、月度预算与周期记账等新功能。
--   固定 UUID + ON CONFLICT DO NOTHING，确保幂等可重跑。

BEGIN;

-- Step 1: 插入新公告——近期新功能
INSERT INTO announcements (id, title, content, published_at, expires_at)
VALUES (
  'a3d5e7f9-0014-4b8e-c2f0-4e5f6a7b8c9d',
  'Costra 新功能上线啦',
  'Costra 更新啦！本次带来几项实用新功能：

新增功能
· 周期记账：支持按每x天、每个工作日、每x周、每x月或每年自动定时记账，设置一次即可自动沉淀流水
· 账本资产：账本可维护资产净值余额，随流水变动自动更新
· 月度预算：为账本设置每月预算，实时掌握支出进度

体验优化
· 明细页筛选升级，支持搜索关键词与分类多选，查找流水更高效
· 年度页月度流水改版为更清晰的三色线条可视化

快来体验新功能吧，让记账更省心～
',
  now(),
  NULL
) ON CONFLICT (id) DO NOTHING;

COMMIT;
