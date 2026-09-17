// templates/daily.mjs · 日报 template（window < 2d）· v2 完善版
// 改进：表头说明、分账本多行、ASCII 柱状图、活跃/低活跃分级、留存率、自动记账预警

import {
  fmtAmount, fmtAmountShort, fmtBadge, fmtCategory, fmtTime, fmtNickname,
  fmtEntryType, fmtDuration, fmtText, renderSection, isoToShort,
  renderImportsSection, renderExportsSection, renderTipsSection,
} from './common.mjs';

/**
 * 渲染日报 Markdown
 * @param {object} data - { summary, users, ledgers, entries, invites, importJobs, exportJobs, tips, active, autoOnly, retention, trend, anomaly }
 * @param {object} meta - { anchorIso, windowMs, dumpMtimeIso, windowStartIso, windowEndIso }
 * @param {object} thresholds - { users, ledgers, entries, invites, imports, exports, tips, active }
 * @returns {{ md: string, subject: string }}
 */
export function renderDaily(data, meta, thresholds) {
  const { summary, users, ledgers, entries, invites, importJobs, exportJobs, tips, active, autoOnly, retention, trend, anomaly } = data;
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
  const newUsers       = Number(s.new_users || 0);
  const newLedgers     = Number(s.new_ledgers || 0);
  const newEntries     = Number(s.new_entries || 0);
  const entriesAmt     = Number(s.new_entries_amount_cents || 0);
  const manualEntries  = Number(s.manual_entries || 0);
  const autoEntries    = Number(s.auto_entries || 0);
  const manualAmt   = Number(s.manual_amount_cents || 0);
  const autoAmt   = Number(s.auto_amount_cents || 0);
  const newInvites= Number(s.new_invites || 0);
  const usedInvites    = Number(s.new_invites_used || 0);
  const activeUsers    = Number(s.active_users || 0);
  const newImports       = Number(s.new_imports || 0);
  const importSucceeded  = Number(s.import_succeeded || 0);
  const importFailed     = Number(s.import_failed || 0);
  const importedRows     = Number(s.imported_rows || 0);
  const newExports       = Number(s.new_exports || 0);
  const exportSucceeded  = Number(s.export_succeeded || 0);
  const exportFailed     = Number(s.export_failed || 0);
  const exportedEntries  = Number(s.exported_entries || 0);
  const newTips          = Number(s.new_tips || 0);
  const tipDelivered     = Number(s.tip_delivered || 0);
  const tipAmountCents   = Number(s.tip_amount_cents || 0);
  const supportDeltaSum  = Number(s.support_delta_sum || 0);

  // ─── subject ───────────────────────────────────────────────────────────────
  const subject = `Costra 日报 · ${anchorDate} · dump@${dumpShort} · +${newUsers}用户 +${newLedgers}账本 +${newEntries}记账（${fmtAmountShort(entriesAmt)}）+${newInvites}邀请 +${newImports}导入 +${newExports}导出 +${newTips}赞赏`;

  // ─── 活跃用户分级统计 ───────────────────────────────────────────────────────
  const highActiveList = (active || []).filter(u => u.activity_level === 'high_active');
  const activeList = (active || []).filter(u => u.activity_level === 'active' || u.activity_level === 'high_active');
  const normalActiveList = (active || []).filter(u => u.activity_level === 'active');

  // ─── 留存率 ────────────────────────────────────────────────────────────────
  const retentionData = retention || [];

  // ─── 各节渲染 ──────────────────────────────────────────────────────────────
  const sections = [];

  // ── 概览面板 ───────────────────────────────────────────────────────────────
  sections.push(renderOverviewPanel({
    newUsers, newLedgers, newEntries, entriesAmt,
    manualEntries, autoEntries, manualAmt, autoAmt,
    newInvites, usedInvites, activeUsers,
    activeCount: activeList.length, highActiveCount: highActiveList.length,
    personalLedgers: Number(s.personal_ledgers || 0),
    sharedLedgers: Number(s.shared_ledgers || 0),
    newImports, importSucceeded, importFailed, importedRows,
    newExports, exportSucceeded, exportFailed, exportedEntries,
    newTips, tipDelivered, tipAmountCents, supportDeltaSum,
    retentionData,
  }));

  // ── 趋势图（7天） ──────────────────────────────────────────────────────────
  if (trend && trend.length > 0) {
    sections.push(renderTrendChart(trend));
  }

  // ── 新增用户 ───────────────────────────────────────────────────────────────
  sections.push(renderUsersSection(users, thresholds.users, newUsers));

  // ── 新增账本 ───────────────────────────────────────────────────────────────
  sections.push(renderLedgersSection(ledgers, thresholds.ledgers, newLedgers));

  // ── 新增记账 ───────────────────────────────────────────────────────────────
  sections.push(renderEntriesSection(entries, thresholds.entries));

  // ── 新增邀请 ───────────────────────────────────────────────────────────────
  sections.push(renderInvitesSection(invites, thresholds.invites, newInvites));

  // ── 账本导入 ───────────────────────────────────────────────────────────────
  sections.push(renderImportsSection(importJobs, thresholds.imports, newImports));

  // ── 账本导出 ───────────────────────────────────────────────────────────────
  sections.push(renderExportsSection(exportJobs, thresholds.exports, newExports));

  // ── 赞赏支持 ───────────────────────────────────────────────────────────────
  sections.push(renderTipsSection(tips, thresholds.tips, newTips));

  // ── 活跃用户（分级） ───────────────────────────────────────────────────────
  sections.push(renderActiveSection(highActiveList, normalActiveList, thresholds.active));

  // ── 自动记账预警 ───────────────────────────────────────────────────────────
  if (autoOnly && autoOnly.length > 0) {
    sections.push(renderAutoOnlySection(autoOnly));
  }

  // ── 留存率详情 ─────────────────────────────────────────────────────────────
  if (retentionData.length > 0) {
  sections.push(renderRetentionSection(retentionData));
  }

  // ── 异常信号 ───────────────────────────────────────────────────────────────
  sections.push(renderAnomalySection(anomaly));

  // ─── 拼装 ──────────────────────────────────────────────────────────────────
  const md = `# Costra 日报 · ${anchorDate} ${weekday}

> 分析窗口：${windowStartShort} → ${windowEndShort}（最近 ${windowLabel} · 数据源 dump@${dumpShort}）

${sections.join('\n---\n\n')}`;

  return { md, subject };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 概览面板
// ═══════════════════════════════════════════════════════════════════════════════

function renderOverviewPanel(d) {
  const lines = [
    '## 📊 概览',
    '',
    '| 指标 | 数值 | 说明 |',
    '|:-----|-----:|:-----|',
    `| 日活用户 | **${d.activeUsers}** | 过去 24h 窗口内有记账行为的人数 |`,
    `| 活跃用户（7天≥2天） | **${d.activeCount}** | 最近7天有≥2天记账 |`,
    `| 高活跃用户（7天≥5天） | **${d.highActiveCount}** | 最近7天有≥5天记账（含在活跃内） |`,
    `| 新增用户 | **${d.newUsers}** | 窗口内注册 |`,
    `| 新增账本 | **${d.newLedgers}** | 个人 ${d.personalLedgers} + 家庭 ${d.sharedLedgers} |`,
    `| 新增记账 | **${d.newEntries}** | 手动 ${d.manualEntries} + 自动 ${d.autoEntries} |`,
    `| 记账总额 | **${fmtAmount(d.entriesAmt)}** | 手动 ${fmtAmountShort(d.manualAmt)} / 自动 ${fmtAmountShort(d.autoAmt)} |`,
    `| 新增邀请 | **${d.newInvites}** | 已使用 ${d.usedInvites} |`,
    `| 账本导入 | **${d.newImports}** | 成功 ${d.importSucceeded} / 失败 ${d.importFailed} · 导入流水 ${d.importedRows} 条 |`,
    `| 账本导出 | **${d.newExports}** | 成功 ${d.exportSucceeded} / 失败 ${d.exportFailed} · 导出流水 ${d.exportedEntries} 条 |`,
    `| 赞赏订单 | **${d.newTips}** | 已交付 ${d.tipDelivered}（${fmtAmount(d.tipAmountCents)} · 支持度 +${d.supportDeltaSum}） |`,
  ];

  // 留存率行
  for (const r of d.retentionData) {
    const label = r.cohort === '7d' ? '7日留存率' : '30日留存率';
    const desc = r.cohort === '7d' ? '7~14天前注册用户' : '30~37天前注册用户';
    lines.push(`| ${label} | **${r.retention_pct}%** | ${desc}（${r.retained_count}/${r.cohort_size}） |`);
  }

  lines.push('');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7天趋势柱状图（ASCII art · 高可读性）
// ═══════════════════════════════════════════════════════════════════════════════

function renderTrendChart(trend) {
  const lines = ['## 📈 7天趋势', ''];

  // ── 活跃用户柱状图 ──
  lines.push('### 每日活跃用户');
  lines.push('```');
  const activeVals = trend.map(t => Number(t.active_users || 0));
  lines.push(...renderBarChart(trend.map(t => t.date_label), activeVals, '人'));
  lines.push('```');
  lines.push('');

  // ── 新增注册柱状图 ──
  lines.push('### 每日新增注册');
  lines.push('```');
  const regVals = trend.map(t => Number(t.new_users || 0));
  lines.push(...renderBarChart(trend.map(t => t.date_label), regVals, '人'));
  lines.push('```');
  lines.push('');

  // ── 记账条数柱状图（手动/自动分开） ──
  lines.push('### 每日记账（手动 ■ / 自动 □）');
  lines.push('```');
  const manualVals = trend.map(t => Number(t.manual_entries || 0));
  const autoVals = trend.map(t => Number(t.auto_entries || 0));
  lines.push(...renderStackedBarChart(trend.map(t => t.date_label), manualVals, autoVals));
  lines.push('```');
  lines.push('');

  // ── 数据表格 ──
  lines.push('| 日期 | 星期 | 活跃用户 | 新注册 | 手动记账 | 自动记账 | 合计 |');
  lines.push('|:----:|:----:|--------:|-------:|--------:|--------:|-----:|');
  for (const t of trend) {
    lines.push(`| ${t.date_label} | ${t.weekday} | ${t.active_users} | ${t.new_users} | ${t.manual_entries} | ${t.auto_entries} | ${t.total_entries} |`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * 渲染水平柱状图
 * @param {string[]} labels - 日期标签
 * @param {number[]} values - 数值
 * @param {string} unit - 单位
 * @returns {string[]}
 */
function renderBarChart(labels, values, unit) {
const maxVal = Math.max(...values, 1);
  const maxBarWidth = 30;
  const lines = [];
  const maxValWidth = String(Math.max(...values)).length;

  for (let i = 0; i < labels.length; i++) {
    const barLen = Math.round((values[i] / maxVal) * maxBarWidth);
    const bar = '█'.repeat(barLen);
    const padding = ' '.repeat(maxBarWidth - barLen);
    const label = labels[i].padEnd(5);
    const valStr = String(values[i]).padStart(maxValWidth);
    lines.push(`  ${label} │${bar}${padding} ${valStr}${unit}`);
  }
  return lines;
}

/**
 * 渲染堆叠柱状图（手动 + 自动）
 */
function renderStackedBarChart(labels, manualVals, autoVals) {
const maxVal = Math.max(...manualVals.map((m, i) => m + autoVals[i]), 1);
  const maxBarWidth = 30;
  const lines = [];

  for (let i = 0; i < labels.length; i++) {
    const total = manualVals[i] + autoVals[i];
 const manualLen = Math.round((manualVals[i] / maxVal) * maxBarWidth);
    const autoLen = Math.round((autoVals[i] / maxVal) * maxBarWidth);
    const manualBar = '■'.repeat(manualLen);
    const autoBar = '□'.repeat(autoLen);
    const padding = ' '.repeat(maxBarWidth - manualLen - autoLen);
    const label = labels[i].padEnd(5);
    const valStr = `${manualVals[i]}+${autoVals[i]}=${total}`;
    lines.push(`  ${label} │${manualBar}${autoBar}${padding} ${valStr}`);
  }
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 新增用户
// ═══════════════════════════════════════════════════════════════════════════════

function renderUsersSection(users, threshold, totalCount) {
  const lines = [`## 👤 新增用户（${totalCount}）`, ''];

  if (!users || users.length === 0) {
    lines.push('无新增用户');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| 用户名 | 注册时间 | 资料完善 | 来源 | 加入家庭数 | 窗口内记账（手动/自动） | 首笔记账耗时 |');
  lines.push('|:-------|:---------|:---------|:-----|----------:|:----------------------:|:-------------|');

  const display = users.length > threshold ? users.slice(0, threshold) : users;
  for (const u of display) {
    const profileStatus = (u.has_completed_profile === 't' || u.has_completed_profile === 'true') ? '✅ 已完善' : '❌ 未完善';
    const source = u.invited_registration === 'true' ? '📨 邀请' : '🔍 自然';
    const manualE = Number(u.manual_entries_in_window || 0);
    const autoE = Number(u.auto_entries_in_window || 0);
    const entriesStr = `${manualE} / ${autoE}`;
    const firstEntryStr = u.first_entry_seconds ? fmtDuration(u.first_entry_seconds) : '尚未记账';
    lines.push(`| ${fmtNickname(u.nickname)} | ${fmtTime(u.created_at_cst)} | ${profileStatus} | ${source} | ${u.family_count} | ${entriesStr} | ${firstEntryStr} |`);
  }

  if (users.length > threshold) {
    lines.push(`| _…另 ${users.length - threshold} 人_ | | | | | | |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 新增账本
// ═══════════════════════════════════════════════════════════════════════════════

function renderLedgersSection(ledgers, threshold, totalCount) {
  const lines = [`## 📒 新增账本（${totalCount}）`, ''];

  if (!ledgers || ledgers.length === 0) {
    lines.push('无新增账本');
    lines.push('');
  return lines.join('\n');
  }

  lines.push('| 账本名称 | 类型 | 所属家庭 | 创建者 | 成员数 | 成员 | 创建时间 |');
  lines.push('|:---------|:-----|:---------|:-------|------:|:-----|:---------|');

  const display = ledgers.length > threshold ? ledgers.slice(0, threshold) : ledgers;
  for (const l of display) {
    const deletedTag = l.is_deleted === 't' || l.is_deleted === 'true' ? ' [已删除]' : '';
    const memberCount = Number(l.member_count || 0);
    const memberNames = l.member_names ? fmtText(l.member_names) : '—';
    lines.push(`| ${fmtText(l.ledger_name)}${deletedTag} | ${fmtBadge(l.family_kind)} | ${fmtText(l.family_name)} | ${fmtNickname(l.owner_nickname)} | ${memberCount} | ${memberNames} | ${fmtTime(l.created_at_cst)} |`);
  }

  if (ledgers.length > threshold) {
    lines.push(`| _…另 ${ledgers.length - threshold} 个_ | | | | | | |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 新增记账
// ═══════════════════════════════════════════════════════════════════════════════

function renderEntriesSection(entries, threshold) {
  if (!entries || entries.length === 0) {
    return '## 💰 新增记账（0）\n\n无新增记账\n';
  }

  const lines = [`## 💰 新增记账（${entries.length}）`, ''];

  // 汇总统计
  const totalAmt = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const manualList = entries.filter(e => e.source === 'manual');
  const autoList = entries.filter(e => e.source === 'auto');
  const byType = groupBy(entries, 'type');
const incomeCount   = (byType['income'] || []).length;
  const expenseCount  = (byType['expense'] || []).length;
  const transferCount = (byType['transfer'] || []).length;

  lines.push(`> **汇总**：${entries.length} 条 · 总额 ${fmtAmount(totalAmt)} · 手动 ${manualList.length} / 自动 ${autoList.length} · 支出 ${expenseCount} / 收入 ${incomeCount} / 转账 ${transferCount}`);
  lines.push('');

  // 分账本统计（多行展示）
  const byLedger = groupBy(entries, 'ledger_name');
  const ledgerStats = Object.entries(byLedger)
    .map(([name, es]) => ({
      name: fmtText(name),
      count: es.length,
      badge: fmtBadge(es[0]?.family_kind),
      manual: es.filter(e => e.source === 'manual').length,
    auto: es.filter(e => e.source === 'auto').length,
      familyMemberCount: Number(es[0]?.family_member_count || 0),
      memberBreakdown: fmtText(es[0]?.member_breakdown || '—'),
  }))
    .sort((a, b) => b.count - a.count);

  lines.push('**分账本统计：**');
  lines.push('');
  lines.push('| 账本 | 类型 | 家庭成员数 | 条数（手动/自动） | 成员记账分布 |');
  lines.push('|:-----|:-----|----------:|------------------:|:-------------|');
  for (const l of ledgerStats) {
    lines.push(`| ${l.name} | ${l.badge} | ${l.familyMemberCount} | ${l.count}（${l.manual}/${l.auto}） | ${l.memberBreakdown} |`);
  }
  lines.push('');

  // 分类 Top5
  const byCat = groupBy(entries, e => fmtCategory(e.category_parent, e.category_name));
  const catTop5 = Object.entries(byCat)
  .map(([cat, es]) => ({ cat, count: es.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (catTop5.length > 0) {
    lines.push('**分类 Top5：**');
    lines.push('');
    lines.push('| 分类 | 条数 |');
    lines.push('|:-----|-----:|');
    for (const c of catTop5) {
      lines.push(`| ${c.cat} | ${c.count} |`);
}
    lines.push('');
  }

  // 明细表格
  lines.push('**明细：**');
  lines.push('');
  lines.push('| 时间 | 来源 | 账本 | 类型 | 分类 | 金额 | 记账人 | 备注 |');
  lines.push('|:-----|:----:|:-----|:-----|:-----|-----:|:-------|:-----|');

  const display = entries.length > threshold ? entries.slice(0, threshold) : entries;
  for (const e of display) {
  const sourceIcon = e.source === 'auto' ? '🤖' : '✍️';
    lines.push(`| ${fmtTime(e.created_at_cst)} | ${sourceIcon} | ${fmtText(e.ledger_name)} ${fmtBadge(e.family_kind)} | ${fmtEntryType(e.type)} | ${fmtCategory(e.category_parent, e.category_name)} | ${fmtAmount(e.amount)} | ${fmtNickname(e.created_by_nickname)} | ${e.note_short ? fmtText(e.note_short) : '—'} |`);
  }

  if (entries.length > threshold) {
    lines.push(`| _…另 ${entries.length - threshold} 条_ | | | | | | | |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 新增邀请
// ═══════════════════════════════════════════════════════════════════════════════

function renderInvitesSection(invites, threshold, totalCount) {
  const lines = [`## 📨 新增邀请（${totalCount}）`, ''];

  if (!invites || invites.length === 0) {
    lines.push('无新增邀请');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| 邀请人 | 目标家庭 | 类型 | 状态 | 接受人 | 耗时 |');
  lines.push('|:-------|:---------|:-----|:-----|:-------|:-----|');

  const display = invites.length > threshold ? invites.slice(0, threshold) : invites;
  for (const i of display) {
    const status = i.used_by_nickname ? '✅ 已接受' : '⏳ 待接受';
  const acceptedBy = i.used_by_nickname ? fmtNickname(i.used_by_nickname) : '—';
    const duration = i.accepted_in_seconds ? fmtDuration(i.accepted_in_seconds) : '—';
    lines.push(`| ${fmtNickname(i.inviter_nickname)} | ${fmtText(i.family_name)} | ${fmtBadge(i.family_kind)} | ${status} | ${acceptedBy} | ${duration} |`);
  }

  if (invites.length > threshold) {
    lines.push(`| _…另 ${invites.length - threshold} 条_ | | | | | |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 活跃用户（分级展示）
// ═══════════════════════════════════════════════════════════════════════════════

function renderActiveSection(highActiveList, normalActiveList, threshold) {
  const lines = ['## 🔥 用户活跃度（最近7天）', ''];

  // 高活跃用户
  lines.push(`### 高活跃用户 · 7天内 ≥5天记账（${highActiveList.length} 人）`);
  lines.push('');

  if (highActiveList.length === 0) {
    lines.push('无');
    lines.push('');
  } else {
    lines.push('| 用户名 | 活跃天数 | 手动记账 | 自动记账 | 合计 | 最后记账 |');
    lines.push('|:-------|--------:|--------:|--------:|-----:|:---------|');
    const display = highActiveList.length > threshold ? highActiveList.slice(0, threshold) : highActiveList;
    for (const u of display) {
  lines.push(`| ${fmtNickname(u.nickname)} | ${u.active_days}天 | ${u.manual_total} | ${u.auto_total} | ${u.entries_total} | ${fmtTime(u.last_entry_at_cst)} |`);
    }
    if (highActiveList.length > threshold) {
      lines.push(`| _…另 ${highActiveList.length - threshold} 人_ | | | | | |`);
    }
    lines.push('');
  }

  // 活跃用户（2~4天）
  lines.push(`### 活跃用户 · 7天内 2~4天记账（${normalActiveList.length} 人）`);
  lines.push('');

  if (normalActiveList.length === 0) {
    lines.push('无');
    lines.push('');
  } else {
    lines.push('| 用户名 | 活跃天数 | 手动记账 | 自动记账 | 合计 | 最后记账 |');
    lines.push('|:-------|--------:|--------:|--------:|-----:|:---------|');
    const display = normalActiveList.length > threshold ? normalActiveList.slice(0, threshold) : normalActiveList;
    for (const u of display) {
 lines.push(`| ${fmtNickname(u.nickname)} | ${u.active_days}天 | ${u.manual_total} | ${u.auto_total} | ${u.entries_total} | ${fmtTime(u.last_entry_at_cst)} |`);
    }
    if (normalActiveList.length > threshold) {
      lines.push(`| _…另 ${normalActiveList.length - threshold} 人_ | | | | | |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 自动记账预警
// ═══════════════════════════════════════════════════════════════════════════════

function renderAutoOnlySection(autoOnly) {
  const lines = ['## ⚠️ 仅自动记账预警', ''];
  lines.push('> 以下用户在指定周期内只有自动记账、没有手动记账，可能已停止主动使用。');
  lines.push('');
  lines.push('| 用户名 | 无手动记账时长 | 期间自动记账数 |');
  lines.push('|:-------|:-------------:|-------------:|');

  for (const u of autoOnly) {
    const periodLabel = { '7d': '≥ 1周', '14d': '≥ 2周', '30d': '≥ 1个月' }[u.period] || u.period;
    lines.push(`| ${fmtNickname(u.nickname)} | ${periodLabel} | ${u.auto_entries} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 留存率详情
// ═══════════════════════════════════════════════════════════════════════════════

function renderRetentionSection(retentionData) {
  const lines = ['## 📊 留存率', ''];
  lines.push('| 群组 | 群组人数 | 留存人数 | 留存率 | 说明 |');
  lines.push('|:-----|--------:|--------:|------:|:-----|');

  for (const r of retentionData) {
    const label = r.cohort === '7d' ? '7日留存' : '30日留存';
    const desc = r.cohort === '7d'
      ? '7~14天前注册 → 最近7天仍活跃'
      : '30~37天前注册 → 最近7天仍活跃';
    const pctBar = renderMiniBar(Number(r.retention_pct || 0));
    lines.push(`| ${label} | ${r.cohort_size} | ${r.retained_count} | ${r.retention_pct}% ${pctBar} | ${desc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderMiniBar(pct) {
  const filled = Math.round(pct / 10);
  return '▓'.repeat(filled) + '░'.repeat(10 - filled);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 异常信号
// ═══════════════════════════════════════════════════════════════════════════════

function renderAnomalySection(anomaly) {
  const lines = ['## 🚨 异常信号', ''];

  if (!anomaly || anomaly.length === 0) {
    lines.push('无异常');
    lines.push('');
    return lines.join('\n');
  }

  for (const a of anomaly) {
    const kindLabel = a.kind === 'high_entry_user' ? '⚠️ 高频用户' : '⚠️ 高频账本';
    lines.push(`- ${kindLabel}：${fmtText(a.ref)}（${a.metric} 条）`);
  }
lines.push('');
  return lines.join('\n');
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
