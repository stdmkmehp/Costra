// pages/family/memberMenu.spec.ts · 成员头像气泡菜单选项矩阵单测
// 卡号: COSTRA-302 · 覆盖 self/owner/普通成员 各分支，防破坏性动作误开放
import { describe, it, expect } from 'vitest';
import { buildMemberMenuItems, type MemberMenuKey } from './memberMenu';

const keys = (ctx: Parameters<typeof buildMemberMenuItems>[0]): MemberMenuKey[] =>
  buildMemberMenuItems(ctx).map(i => i.key);

describe('pages/family/memberMenu · buildMemberMenuItems', () => {
  it('点自己 · owner 单人 → [重命名 · 解散]', () => {
    expect(keys({ isSelf: true, isOwner: true, activeMemberCount: 1 })).toEqual(['rename', 'dissolve']);
  });

  it('点自己 · owner 多人 → [重命名 · 退出 · 解散]', () => {
    expect(keys({ isSelf: true, isOwner: true, activeMemberCount: 3 })).toEqual(['rename', 'leave', 'dissolve']);
  });

  it('点自己 · 普通成员 → [重命名 · 退出]（不含解散）', () => {
    const ks = keys({ isSelf: true, isOwner: false, activeMemberCount: 3 });
    expect(ks).toEqual(['rename', 'leave']);
    expect(ks).not.toContain('dissolve');
    expect(ks).not.toContain('remove');
  });

  it('点他人 · owner → [移出]', () => {
    expect(keys({ isSelf: false, isOwner: true, activeMemberCount: 3 })).toEqual(['remove']);
  });

  it('点他人 · 普通成员 → []（无响应，绝不含破坏性项）', () => {
    const ks = keys({ isSelf: false, isOwner: false, activeMemberCount: 3 });
    expect(ks).toEqual([]);
    expect(ks).not.toContain('remove');
    expect(ks).not.toContain('dissolve');
    expect(ks).not.toContain('leave');
  });

  it('破坏性标记 danger 与 key 对应正确', () => {
    const items = buildMemberMenuItems({ isSelf: true, isOwner: true, activeMemberCount: 3 });
    const dangerMap = Object.fromEntries(items.map(i => [i.key, i.danger]));
    expect(dangerMap.rename).toBe(false);
    expect(dangerMap.leave).toBe(true);
    expect(dangerMap.dissolve).toBe(true);
  });
});
