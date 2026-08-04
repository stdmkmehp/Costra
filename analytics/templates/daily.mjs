// templates/daily.mjs · 日报 template（window < 2d）
// 见 spec §7.4

import {
  fmtAmount, fmtAmountShort, fmtBadge, fmtCategory, fmtTime, fmtNickname,
  fmtEntryType, fmtDuration, fmtText, renderSection, isoToShort,
} from './common.mjs';

/**
 * 渲染日报 Markdown
 * @param {object} data - { summary, users, ledgers, entries, invites, active, anomaly }
 * @param {object} meta - { anchorIso, windowMs, dumpMtimeIso, windowStartIso, windowEndIso }
 * @param {object} thresholds - { users, ledgers, entries, invites, active }
 * @returns {{ md: string, subject: string }}
 */
export function renderDaily(data, meta, thresholds) {
  const { summary, users, ledgers, entries, invites, active, anomaly } = data;
  const { windowMs, dumpMtimeIso, windowStartIso, windowEndIso } = meta;
  const windowLabel = windowMs % 3600_000 === 0
    ? `${windowMs / 3600_000}h`
    : `${Math.round(windowMs / 60_000)}m`;

  // ─── 标题和头部 ────────────────────────────────────────────────────────────
  const anchorDate = windowEndIso.slice(0, 10);
  const weekday = getWeekday(windowEndIso);
  const windowStartShort = isoToShort(windowStartIso);
  const windowEndShort   = isoToShort(windowEndIso);
  const dumpShort        = isoToShort(dumpMtimeIso);

  // ─── 摘要行 ────────────────────────────────────────────────────────────────
  const s = summary[0] || {};
  const newUsers    = Number(s.new_users    || 0);
  const newLedgers  = Number(s.new_ledgers  || 0);
  const newEntries  = Number(s.new_entries  || 0);
  const entriesAmt  = Number(s.new_entries_amount_cents || 0);
  const newInvites  = Number(s.new_invites  || 0);
  const usedInvites = Number(s.new_invites_used || 0);
  const activeUsers = Number(s.active_users || 0);

  const summaryLine = `DAU ${activeUsers} · 新用户 ${newUsers} · 新账本 ${newLedgers} · 新记账 ${newEntries}（${fmtAmount(entriesAmt)}）· 新邀请 ${newInvites}（已使用 ${usedInvites}）`;

  // ─── subject ───────────────────────────────────────────────────────────────
  const subject = `Costra 日报 · ${anchorDate} · dump@${dumpShort} · +${newUsers}用户 +${newLedgers}账本 +${newEntries}记账（${fmtAmountShort(entriesAmt)}）+${newInvites}邀请`;

  // ─── 各节渲染 ──────────────────────────────────────────────────────────────
  const usersSection   = renderUsersSection(users, thresholds.users);
  const ledgersSection = renderLedgersSection(ledgers, thresholds.ledgers);
  const entriesSection = renderEntriesSection(entries, thresholds.entries);
  const invitesSection = renderInvitesSection(invites, thresholds.invites);
  const activeSection  = renderActiveSection(active, thresholds.active);
  const anomalySection = renderAnomalySection(anomaly);

  // ─── 拼装 ──────────────────────────────────────────────────────────────────
  const md = `# Costra 日报 · ${anchorDate} ${weekday}
分析窗口：${windowStartShort} → ${windowEndShort}（最近 ${windowLabel} · 数据源 dump@${dumpShort}）

> ${summaryLine}

## 用户（${newUsers}）
${usersSection}
## 账本（${newLedgers}）
${ledgersSection}
## 记账（${newEntries}）
${entriesSection}
## 邀请（${newInvites}）
${invitesSection}
## 活跃用户（${activeUsers}）
${activeSection}
## 异常信号
${anomalySection}`;

  return { md, subject };
}

// ─── 各节渲染函数 ─────────────────────────────────────────────────────────────

function renderUsersSection(users, threshold) {
  return renderSection(
    users,
    threshold,
    (items) => items.map(u =>
      `- ${fmtNickname(u.nickname)} · ${fmtTime(u.created_at_cst)} · ${u.has_completed_profile === 't' || u.has_completed_profile === 'true' ? '已完成资料' : '未完成资料'} · 窗口内记账 ${u.entries_in_window} 条`
    ).join('\n') + '\n',
    (items, n) => {
      const shown = items.slice(0, n);
      const rest  = items.length - n;
      return shown.map(u =>
        `- ${fmtNickname(u.nickname)} · ${fmtTime(u.created_at_cst)} · ${u.has_completed_profile === 't' || u.has_completed_profile === 'true' ? '已完成资料' : '未完成资料'} · 窗口内记账 ${u.entries_in_window} 条`
      ).join('\n') + `\n- _…另 ${rest} 人（共 ${items.length} 人）_\n`;
    }
  );
}

function renderLedgersSection(ledgers, threshold) {
  return renderSection(
    ledgers,
    threshold,
    (items) => items.map(l =>
      `- ${fmtText(l.ledger_name)} ${fmtBadge(l.family_kind)} · ${fmtNickname(l.owner_nickname)} · ${fmtTime(l.created_at_cst)}`
    ).join('\n') + '\n',
    (items, n) => {
      const shown = items.slice(0, n);
      const rest  = items.length - n;
      return shown.map(l =>
        `- ${fmtText(l.ledger_name)} ${fmtBadge(l.family_kind)} · ${fmtNickname(l.owner_nickname)} · ${fmtTime(l.created_at_cst)}`
      ).join('\n') + `\n- _…另 ${rest} 个（共 ${items.length} 个）_\n`;
    }
  );
}

function renderEntriesSection(entries, threshold) {
  if (entries.length === 0) return '无新增\n';

  const totalAmt = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const byType = groupBy(entries, 'type');
  const incomeCount   = (byType['income']   || []).length;
  const expenseCount  = (byType['expense']  || []).length;
  const transferCount = (byType['transfer'] || []).length;
  const sharedCount   = entries.filter(e => e.shared_type === 'shared').length;
  const sharedPct     = entries.length > 0 ? Math.round(sharedCount / entries.length * 100) : 0;

  // 分账本统计
  const byLedger = groupBy(entries, 'ledger_name');
  const ledgerStats = Object.entries(byLedger)
    .map(([name, es]) => ({
      name: fmtText(name),
      count: es.length,
      amt: es.reduce((s, e) => s + Number(e.amount || 0), 0),
      badge: fmtBadge(es[0]?.family_kind),
    }))
    .sort((a, b) => b.count - a.count);

  // 分类 Top5
  const byCat = groupBy(entries, e => fmtCategory(e.category_parent, e.category_name));
  const catTop5 = Object.entries(byCat)
    .map(([cat, es]) => ({ cat, count: es.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const summaryStats = [
    `**汇总**：${entries.length} 条 · 总额 ${fmtAmount(totalAmt)} · 支出 ${expenseCount} · 收入 ${incomeCount} · 转账 ${transferCount} · shared ${sharedCount}（${sharedPct}%）`,
    `**分账本**：${ledgerStats.map(l => `${l.name} ${l.badge} ${l.count} 条 ${fmtAmountShort(l.amt)}`).join(' · ')}`,
    catTop5.length > 0
      ? `**分类 Top${Math.min(5, catTop5.length)}**：${catTop5.map(c => `${c.cat} ${c.count}`).join(' · ')}`
      : null,
  ].filter(Boolean).join('\n');

  if (entries.length <= threshold) {
    // 全展
    const tableRows = entries.map(e =>
      `| ${fmtTime(e.created_at_cst)} | ${fmtText(e.ledger_name)} ${fmtBadge(e.family_kind)} | ${fmtEntryType(e.type)} | ${fmtCategory(e.category_parent, e.category_name)} | ${fmtAmount(e.amount)} | ${fmtNickname(e.created_by_nickname)} | ${e.note_short ? fmtText(e.note_short) : '—'} |`
    ).join('\n');

    return `| 时间 | 账本 | 类型 | 分类 | 金额 | 记账人 | 备注 |
|---|---|---|---|---|---|---|
${tableRows}

${summaryStats}
`;
  }

  // 截断：前 threshold 条 + 统计
  const shown = entries.slice(0, threshold);
  const tableRows = shown.map(e =>
    `| ${fmtTime(e.created_at_cst)} | ${fmtText(e.ledger_name)} ${fmtBadge(e.family_kind)} | ${fmtEntryType(e.type)} | ${fmtCategory(e.category_parent, e.category_name)} | ${fmtAmount(e.amount)} | ${fmtNickname(e.created_by_nickname)} | ${e.note_short ? fmtText(e.note_short) : '—'} |`
  ).join('\n');

  return `条数超过阈值（${threshold}），仅列前 ${threshold}：

| 时间 | 账本 | 类型 | 分类 | 金额 | 记账人 | 备注 |
|---|---|---|---|---|---|---|
${tableRows}

${summaryStats}
`;
}

function renderInvitesSection(invites, threshold) {
  return renderSection(
    invites,
    threshold,
    (items) => items.map(i => {
      const accepted = i.used_by_nickname
        ? `已被 ${fmtNickname(i.used_by_nickname)} 接受（耗时 ${fmtDuration(i.accepted_in_seconds)}）`
        : '未使用';
      return `- ${fmtNickname(i.inviter_nickname)} → ${i.family_kind === 'shared' ? '家庭' : '个人'}账本“${fmtText(i.family_name)}” · ${accepted}`;
    }).join('\n') + '\n',
    (items, n) => {
      const shown = items.slice(0, n);
      const rest  = items.length - n;
      const lines = shown.map(i => {
        const accepted = i.used_by_nickname
          ? `已被 ${fmtNickname(i.used_by_nickname)} 接受（耗时 ${fmtDuration(i.accepted_in_seconds)}）`
          : '未使用';
        return `- ${fmtNickname(i.inviter_nickname)} → ${i.family_kind === 'shared' ? '家庭' : '个人'}账本“${fmtText(i.family_name)}” · ${accepted}`;
      });
      return lines.join('\n') + `\n- _…另 ${rest} 条（共 ${items.length} 条）_\n`;
    }
  );
}

function renderActiveSection(active, threshold) {
  return renderSection(
    active,
    threshold,
    (items) => items.map(u =>
      `- ${fmtNickname(u.nickname)} · ${u.entries_count} 条 ${fmtAmount(u.entries_amount_cents)}`
    ).join('\n') + '\n',
    (items, n) => {
      const shown = items.slice(0, n);
      const rest  = items.length - n;
      return shown.map(u =>
        `- ${fmtNickname(u.nickname)} · ${u.entries_count} 条 ${fmtAmount(u.entries_amount_cents)}`
      ).join('\n') + `\n- _…另 ${rest} 人（共 ${items.length} 人）_\n`;
    }
  );
}

function renderAnomalySection(anomaly) {
  if (!anomaly || anomaly.length === 0) return '无\n';
  return anomaly.map(a => {
    const kindLabel = a.kind === 'high_entry_user' ? '高频用户' : '高频账本';
    return `- ⚠️ ${kindLabel}：${fmtText(a.ref)}（${a.metric} 条）`;
  }).join('\n') + '\n';
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function getWeekday(iso) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', weekday: 'short',
  }).format(new Date(iso));
}

function groupBy(arr, keyOrFn) {
  const fn = typeof keyOrFn === 'function' ? keyOrFn : (item) => item[keyOrFn];
  return arr.reduce((groups, item) => {
    const key = fn(item);
    (groups[key] = groups[key] || []).push(item);
    return groups;
  }, {});
}
