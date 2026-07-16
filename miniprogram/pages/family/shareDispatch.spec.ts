// pages/family/shareDispatch.spec.ts · 双态分派纯函数单测
//
// 覆盖目标：锁死协作邀请（场景 A）与推广型分享（场景 B）的判定边界。
// 关键不变量：只有 (from === 'button' && pendingInviteToken 非空) 才走邀请分支；
// 其它任意组合（menu / undefined / 空 token）均走推广分支，绝不误触发副作用。
//
// 这条测试是"协作邀请功能等价性"的机器可验证凭证——任何降低判定精度的改动
// 都会被立即拦截。

import { describe, it, expect } from 'vitest';
import { dispatchFamilyShare } from './shareDispatch';

describe('pages/family/shareDispatch · 场景 A（协作邀请）', () => {
  it('button + 有 token → invite 分支，携带原 token', () => {
    const d = dispatchFamilyShare({ from: 'button', pendingInviteToken: 'tok_abc' });
    expect(d).toEqual({ kind: 'invite', inviteToken: 'tok_abc' });
  });

  it('token 原样传递（不做任何加工）', () => {
    const d = dispatchFamilyShare({ from: 'button', pendingInviteToken: 'tok-with-dash_and_underscore' });
    expect(d.kind).toBe('invite');
    if (d.kind === 'invite') {
      expect(d.inviteToken).toBe('tok-with-dash_and_underscore');
    }
  });
});

describe('pages/family/shareDispatch · 场景 B（推广型分享 · 保护协作邀请状态机）', () => {
  it('menu + 无 token → promo（右上角胶囊菜单常规路径）', () => {
    expect(dispatchFamilyShare({ from: 'menu', pendingInviteToken: '' })).toEqual({ kind: 'promo' });
  });

  it('menu + 有残留 token → promo（关键：不因残留 token 误进邀请分支）', () => {
    // 场景：用户打开过邀请遮罩生成 token，未点分享直接关掉，_pendingInviteToken 理论已被 _resetPendingInviteState 清空；
    // 但即便清理失败留下残留，胶囊菜单也绝不能进邀请分支，否则会误置 _pendingInviteShared 导致遮罩误关。
    expect(dispatchFamilyShare({ from: 'menu', pendingInviteToken: 'tok_leftover' })).toEqual({ kind: 'promo' });
  });

  it('button + 无 token → promo（token 尚未就绪时保护性兜底）', () => {
    // 邀请遮罩内 <button open-type="share"> 仅在 inviteReady=true 后可点，token 必已就绪；
    // 但代码不依赖此 UI 门控，判定层自身要保证 token 空则不走邀请分支。
    expect(dispatchFamilyShare({ from: 'button', pendingInviteToken: '' })).toEqual({ kind: 'promo' });
  });

  it('from 为 undefined → promo（兼容微信旧基础库或异常调用）', () => {
    expect(dispatchFamilyShare({ from: undefined, pendingInviteToken: 'tok_abc' })).toEqual({ kind: 'promo' });
  });

  it('未知 from 值 → promo（防御未来微信新增来源）', () => {
    expect(dispatchFamilyShare({ from: 'unknown-future-source', pendingInviteToken: 'tok_abc' })).toEqual({ kind: 'promo' });
  });
});

describe('pages/family/shareDispatch · 纯函数性质', () => {
  it('无副作用 · 输入不可变', () => {
    const input = { from: 'button' as const, pendingInviteToken: 'tok_abc' };
    const snapshot = { ...input };
    dispatchFamilyShare(input);
    expect(input).toEqual(snapshot);
  });

  it('相同输入两次调用返回等价结果', () => {
    const a = dispatchFamilyShare({ from: 'button', pendingInviteToken: 'tok_x' });
    const b = dispatchFamilyShare({ from: 'button', pendingInviteToken: 'tok_x' });
    expect(a).toEqual(b);
  });
});
