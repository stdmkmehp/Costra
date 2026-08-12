// pages/family/memberMenu.spec.ts · 成员头像气泡菜单选项矩阵单测
// 卡号: COSTRA-302 · 覆盖 self/owner/普通成员 各分支，防破坏性动作误开放
import { describe, it, expect } from 'vitest';
import { buildMemberMenuItems, type MemberMenuKey } from './memberMenu';

const keys = (ctx: Parameters<typeof buildMemberMenuItems>[0]): MemberMenuKey[] =>
  buildMemberMenuItems(ctx).map(i => i.key);

describe('pages/family/memberMenu · buildMemberMenuItems', () => {
  it('点自己 · owner 单人 → [重命名 · 换颜色 · 解散]', () => {
    expect(keys({ isSelf: true, isOwner: true, activeMemberCount: 1 })).toEqual(['rename', 'colorChoice', 'dissolve']);
  });

  it('点自己 · owner 多人 → [重命名 · 换颜色 · 退出 · 解散]', () => {
    expect(keys({ isSelf: true, isOwner: true, activeMemberCount: 3 })).toEqual(['rename', 'colorChoice', 'leave', 'dissolve']);
  });

  it('点自己 · 普通成员 → [重命名 · 换颜色 · 退出]（不含解散）', () => {
    const ks = keys({ isSelf: true, isOwner: false, activeMemberCount: 3 });
    expect(ks).toEqual(['rename', 'colorChoice', 'leave']);
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
    expect(dangerMap.colorChoice).toBe(false);
    expect(dangerMap.leave).toBe(true);
    expect(dangerMap.dissolve).toBe(true);
  });

  // ─── personal family 语义防御（migration 0017 · 换颜色仅 shared 可用） ───

  it('点自己 · personal family owner 单人 → [重命名 · 解散]（不含换颜色）', () => {
    const ks = keys({ isSelf: true, isOwner: true, activeMemberCount: 1, familyKind: 'personal' });
    expect(ks).toEqual(['rename', 'dissolve']);
    expect(ks).not.toContain('colorChoice');
  });

  it('点自己 · personal family 普通成员 → [重命名 · 退出]（不含换颜色）', () => {
    // 理论上 personal family 不存在非 owner 成员，这里仅做防御性验证
    const ks = keys({ isSelf: true, isOwner: false, activeMemberCount: 1, familyKind: 'personal' });
    expect(ks).not.toContain('colorChoice');
  });

  it('未传 familyKind 时默认按 shared 处理（向后兼容）', () => {
    // 未指定 familyKind 时，换颜色应保留（与既有行为一致）
    const ks = keys({ isSelf: true, isOwner: true, activeMemberCount: 3 });
    expect(ks).toContain('colorChoice');
  });

  it('shared family 显式传入时下发换颜色', () => {
    const ks = keys({ isSelf: true, isOwner: true, activeMemberCount: 3, familyKind: 'shared' });
    expect(ks).toContain('colorChoice');
  });
});
