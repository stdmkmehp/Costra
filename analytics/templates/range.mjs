// templates/range.mjs · 区间报告 template（2d ≤ window < 7d）
// 见 spec §7.5

import {
  fmtAmount, fmtAmountShort, fmtBadge, fmtCategory, fmtNickname,
  fmtDuration, fmtText, renderSection, isoToShort,
} from './common.mjs';

/**
 * 渲染区间报告 Markdown
 * @param {object} data - { summary, users, ledgers, entries, invites, active, anomaly }
 * @param {object} meta - { anchorIso, windowMs, dumpMtimeIso, windowStartIso, windowEndIso }
 * @param {object} thresholds
 * @returns {{ md: string, subject: string }}
 */
export function renderRange(data, meta, thresholds) {
  const { summary, users, ledgers, entries, invites, active, anomaly } = data;
  const { windowMs, dumpMtimeIso, windowStartIso, windowEndIso } = meta;

  const windowDays = Math.round(windowMs / 86400_000);
  const startDate  = windowStartIso.slice(0, 10);
  const endDate    = windowEndIso.slice(0, 10);
  const dumpShort  = isoToShort(dumpMtimeIso);

  const s = summary[0] || {};
  const newUsers    = Number(s.new_users    || 0);
  const newLedgers  = Number(s.new_ledgers  || 0);
  const newEntries  = Number(s.new_entries  || 0);
  const entriesAmt  = Number(s.new_entries_amount_cents || 0);
  const newInvites  = Number(s.new_invites  || 0);
  const usedInvites = Number(s.new_invites_used || 0);
  const activeUsers = Number(s.active_users || 0);

  const summaryLine = `活跃用户 ${activeUsers} · 新用户 ${newUsers} · 新账本 ${newLedgers} · 新记账 ${newEntries}（${fmtAmount(entriesAmt)}）· 新邀请 ${newInvites}（已使用 ${usedInvites}）`;

  const subject = `Costra 报告 · ${windowDays}d · ${startDate}→${endDate} · +${newUsers}用户 +${newLedgers}账本 +${newEntries}记账（${fmtAmountShort(entriesAmt)}）+${newInvites}邀请`;

  // ─── 各节（range 模式：记账永远走统计版，其他按阈值）──────────────────────
  const usersSection   = renderUsersSection(users, thresholds.users);
  const ledgersSection = renderLedgersSection(ledgers, thresholds.ledgers);
  const entriesSection = renderEntriesStats(entries);   // 永远统计版
  const invitesSection = renderInvitesSection(invites, thresholds.invites);
  const activeSection  = renderActiveSection(active, thresholds.active);
  const anomalySection = renderAnomalySection(anomaly);

  const md = `# Costra 报告 · ${windowDays}d · ${startDate} → ${endDate}
分析窗口：${isoToShort(windowStartIso)} → ${isoToShort(windowEndIso)}（数据源 dump@${dumpShort}）

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

// ─── 各节渲染 ─────────────────────────────────────────────────────────────────

function renderUsersSection(users, threshold) {
  return renderSection(
    users,
    threshold,
    (items) => items.map(u =>
      `- ${fmtNickname(u.nickname)} · ${u.created_at_cst} · ${u.has_completed_profile === 't' || u.has_completed_profile === 'true' ? '已完成资料' : '未完成资料'}`
    ).join('\n') + '\n',
    (items, n) => {
      const shown = items.slice(0, n);
      const rest  = items.length - n;
      return shown.map(u =>
        `- ${fmtNickname(u.nickname)} · ${u.created_at_cst}`
      ).join('\n') + `\n- _…另 ${rest} 人（共 ${items.length} 人）_\n`;
    }
  );
}

function renderLedgersSection(ledgers, threshold) {
  return renderSection(
    ledgers,
    threshold,
    (items) => items.map(l =>
      `- ${fmtText(l.ledger_name)} ${fmtBadge(l.family_kind)} · ${fmtNickname(l.owner_nickname)} · ${l.created_at_cst}`
    ).join('\n') + '\n',
    (items, n) => {
      const shown = items.slice(0, n);
      const rest  = items.length - n;
      return shown.map(l =>
        `- ${fmtText(l.ledger_name)} ${fmtBadge(l.family_kind)} · ${fmtNickname(l.owner_nickname)}`
      ).join('\n') + `\n- _…另 ${rest} 个（共 ${items.length} 个）_\n`;
    }
  );
}

function renderEntriesStats(entries) {
  if (entries.length === 0) return '无新增\n';

  const totalAmt     = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const byType       = groupBy(entries, 'type');
  const incomeCount  = (byType['income']   || []).length;
  const expenseCount = (byType['expense']  || []).length;
  const transferCount= (byType['transfer'] || []).length;
  const sharedCount  = entries.filter(e => e.shared_type === 'shared').length;
  const sharedPct    = Math.round(sharedCount / entries.length * 100);

  const byLedger = groupBy(entries, 'ledger_name');
  const ledgerStats = Object.entries(byLedger)
    .map(([name, es]) => ({
      name: fmtText(name),
      count: es.length,
      amt: es.reduce((s, e) => s + Number(e.amount || 0), 0),
      badge: fmtBadge(es[0]?.family_kind),
    }))
    .sort((a, b) => b.count - a.count);

  const byCat = groupBy(entries, e => fmtCategory(e.category_parent, e.category_name));
  const catTop5 = Object.entries(byCat)
    .map(([cat, es]) => ({ cat, count: es.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return `**汇总**：${entries.length} 条 · 总额 ${fmtAmount(totalAmt)} · 支出 ${expenseCount} · 收入 ${incomeCount} · 转账 ${transferCount} · shared ${sharedCount}（${sharedPct}%）

**分账本**：${ledgerStats.map(l => `${l.name} ${l.badge} ${l.count} 条 ${fmtAmountShort(l.amt)}`).join(' · ')}

${catTop5.length > 0 ? `**分类 Top${Math.min(5, catTop5.length)}**：${catTop5.map(c => `${c.cat} ${c.count}`).join(' · ')}` : ''}
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
      return shown.map(i => {
        const accepted = i.used_by_nickname
          ? `已被 ${fmtNickname(i.used_by_nickname)} 接受`
          : '未使用';
        return `- ${fmtNickname(i.inviter_nickname)} → “${fmtText(i.family_name)}” · ${accepted}`;
      }).join('\n') + `\n- _…另 ${rest} 条（共 ${items.length} 条）_\n`;
    }
  );
}

function renderActiveSection(active, threshold) {
  // 兼容新版 60-active-users.sql 字段名
  const items = (active || []).filter(u => u.activity_level === 'active' || u.activity_level === 'low_active');
  if (items.length === 0) return '无\n';
  return renderSection(
    items,
    threshold,
    (list) => list.map(u =>
      `- ${fmtNickname(u.nickname)} · ${u.active_days}天活跃 · ${u.entries_total} 条 · 手动 ${u.manual_total} / 自动 ${u.auto_total}`
    ).join('\n') + '\n',
    (list, n) => {
      const shown = list.slice(0, n);
      const rest  = list.length - n;
      return shown.map(u =>
  `- ${fmtNickname(u.nickname)} · ${u.active_days}天活跃 · ${u.entries_total} 条`
      ).join('\n') + `\n- _…另 ${rest} 人（共 ${list.length} 人）_\n`;
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

function groupBy(arr, keyOrFn) {
  const fn = typeof keyOrFn === 'function' ? keyOrFn : (x) => x[keyOrFn];
  return arr.reduce((acc, item) => {
    const k = fn(item);
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}
