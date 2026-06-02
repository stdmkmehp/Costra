// config/slogans.ts · App 共用格言库
// 设计规范：design/ui/design_spec.md §6.1 · 至少 8 句

export const SLOGANS: readonly string[] = [
  '每一笔支出，都在为你想要的世界投票',
  '每一笔支出，都在为你想要的世界投票',
  '每一笔支出，都在为你想要的世界投票',
  '不记账的生活，像没有地图的旅行',
  '量入为出，是成年人最基本的自律',
  '账本，是你最诚实的自传',
  '每一条流水，都在悄悄定义你',
  '记录，是为了不再焦虑',
  '不仅记录开销，也记录走过的路',
  '每一笔流水，都是生活的刻度',
  '你予数字以意义，数字予你以澄明',
  '消费主义的尽头，是面对真实的自我',
  '真正的奢侈，是不被欲望裹挟的自由',
] as const;

export function pickRandomSlogan(excluding?: string): string {
  const candidates = excluding
    ? Array.from(new Set(SLOGANS)).filter(slogan => slogan !== excluding)
    : SLOGANS;
  const pool = candidates.length > 0 ? candidates : SLOGANS;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}
