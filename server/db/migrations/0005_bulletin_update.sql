-- Costra · 公告更新：删档公测→不删档公测 + 近期更新公告
-- 依赖：0002_announcements.sql
-- 幂等：UPDATE 反复执行无副作用；INSERT 使用 ON CONFLICT DO NOTHING

BEGIN;

-- Step 1: 过期所有旧的「删档公测说明」公告
-- 只标记过期，不物理删除，保留完整历史记录。
-- 旧版 0002 的种子 INSERT 无固定 UUID（gen_random_uuid()），历史部署可能产生多条，
-- 此处批量过期全部匹配标题的活跃公告。
UPDATE announcements
   SET expires_at = now(),
       updated_at = now()
 WHERE title = '删档公测说明'
   AND deleted_at IS NULL
   AND (expires_at IS NULL OR expires_at > now());

-- Step 2: 插入新公告——不删档公测开启 + 近期更新
-- 使用固定 UUID + ON CONFLICT DO NOTHING，确保幂等可重跑。
INSERT INTO announcements (id, title, content, published_at, expires_at)
VALUES (
  'f9e1b2c3-0005-4a7d-b8e1-2c3d4a5b6e7f',
  '不删档公测已开启',
  'Costra 已于 2026 年 6 月 11 日正式切换为不删档公测！从现在起，您的所有记账数据都将安全保留，不会在公测结束后清除。

以下是近期的更新内容：

启动与加载优化
· 启动速度大幅提升，代码包体积精简 23%
· 明细页递进式加载：进入即展示最近流水，后台补齐完整数据，秒开不等待
· 排行榜下钻加载优化：快速响应时不再闪现"加载中..."，体验更流畅
· 首屏展示智能预热：进入统计、协作页更快看到数据

体验与功能
· 修复偶现打开后未恢复上次使用的协作账本问题
· 统计页排行区"首次点不开"问题彻底修复
· 统计折线图增强：最高点标注金额与日期，周期分隔线一目了然
· 分类优化：新增「早餐」「午餐」「晚餐」及「水费」「电费」「燃气费」等细分
· 转移类型：支持储值（公交卡、饭卡等）、账户互转、赊销（花呗、白条、信用卡等）
· 数据同步稳定性增强

感谢每一位参与测试的用户，你们的反馈帮助我们越做越好！',
  now(),
  NULL
) ON CONFLICT (id) DO NOTHING;

COMMIT;
