/**
 * Costra · Server · 导入示例 CSV 生成器（data-import-export v1.1）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md §4.6
 *
 * 一个文件同时承担两个职责（CSV 无注释语法，无法分"示例区 + 清单区"）：
 *   1. 规范格式示范：每行都是合法可导入记录（9 标准列 + BOM + CRLF + quote-all，
 *      表头指纹 ⇒ is_costra_export，用户改完导回走最完整校验路径）；
 *   2. 全分类清单：每个可导入二级分类一行（系统 + 家庭自定义），用户删行即完成选型。
 *
 * 填充口径（与用户确认的冻结值）：
 *   - 日期 = 生成日、时间 = 生成时刻（Asia/Shanghai · 全文件统一值，Excel 一次查找替换改完）；
 *   - 金额 = 0.01（最小合法值，即使整文件误导入 88 行合计 0.88 元，几乎无害）；
 *   - 归属：共同/个人交替（shared）/ 全部个人（personal · 与导入时 SHARED_FORCED_PERSONAL
 *     口径一致，所见即所得）；收入/转账留空；
 *   - 记账人：目标家庭活跃成员昵称轮换（个人账本恒为唯一成员）；
 *   - 备注：统一「这是一条备注样例」。
 *
 * 纯函数，不依赖 DB/IO，单测直接注入夹具。
 */

import { DateTime } from 'luxon';
import type { CategoryEntity } from '../repositories/categoryRepo.js';
import { CSV_BOM, CSV_CRLF, formatCsvHeaderRow, formatCsvRow } from '../utils/csv.js';

export interface ImportDemoInput {
  familyKind: 'personal' | 'shared';
  /** 目标家庭可见分类（系统 + 自定义 · categoryRepo.findByFamily 原样传入） */
  categories: readonly CategoryEntity[];
  /** 活跃成员昵称（轮换填充记账人 · 至少含操作者本人） */
  memberNicknames: readonly string[];
  /** 生成时刻（Asia/Shanghai · 日期与时间列统一取它） */
  now: DateTime;
}

/** entries.type ↔ 列值（§2.3 列 3） */
const TYPE_LABEL: Record<CategoryEntity['type'], string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
};

/** 组内展示顺序：与记账面板认知一致（支出 → 收入 → 转账） */
const TYPE_ORDER: readonly CategoryEntity['type'][] = ['expense', 'income', 'transfer'];

const DEMO_AMOUNT = '0.01';
const DEMO_NOTE = '这是一条备注样例';

/**
 * 生成导入示例 CSV 全文（含 BOM · 行尾 CRLF · 末行带结尾 CRLF）。
 *
 * 行序：支出组（一级 sortOrder → 二级 sortOrder）→ 收入组 → 转账组。
 * 无子分类的一级不产行：二级留空靠 pickDefaultChild 兜底的路径在无子时不存在，
 * 罗列出来只会生成一条必然 ERROR 的示例（不是合法可导入组合，违反职责 1）。
 */
export function buildImportDemoCsv(input: ImportDemoInput): string {
  const tiers1 = input.categories
    .filter((c) => c.parentId === null)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.sortOrder - b.sortOrder);
  const childrenByParent = new Map<string, CategoryEntity[]>();
  for (const c of input.categories) {
    if (c.parentId === null) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const members = input.memberNicknames;
  const date = input.now.toFormat('yyyy-MM-dd');
  const time = input.now.toFormat('HH:mm');
  const lines: string[] = [formatCsvHeaderRow()];
  let rowIndex = 0;
  let expenseIndex = 0;
  for (const t1 of tiers1) {
    for (const t2 of childrenByParent.get(t1.id) ?? []) {
      const shared =
        t1.type !== 'expense'
          ? ''
          : input.familyKind === 'personal'
            ? '个人'
            : expenseIndex % 2 === 0
              ? '共同'
              : '个人';
      lines.push(
        formatCsvRow([
          date,
          time,
          TYPE_LABEL[t1.type],
          DEMO_AMOUNT,
          t1.name,
          t2.name,
          shared,
          members.length > 0 ? members[rowIndex % members.length]! : '',
          DEMO_NOTE,
        ]),
      );
      rowIndex += 1;
      if (t1.type === 'expense') expenseIndex += 1;
    }
  }
  return CSV_BOM + lines.join(CSV_CRLF) + CSV_CRLF;
}
