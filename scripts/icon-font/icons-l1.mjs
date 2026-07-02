/**
 * Costra 一级分类图标定义（14 个 · 手写矢量 SVG）
 *
 * 从 docs/design/icon-style-demo.html 的 ICONS 抽取而来，作为唯一权威源的一部分。
 * 规范：24×24 viewBox · stroke=currentColor · 线性单色 · 描边 1.5 · round cap/join。
 * 片段为 <g> 内部内容（描边元素无需写 stroke/fill，由外层 g 统一；
 * 实心形状写 fill="currentColor" stroke="none"）。
 *
 * 以「中文分类名」为键，便于人工核对；icon_key 的英文映射见 icons.mjs。
 */
export const ICONS_L1 = {
  餐饮: `
    <path d="M6 3v4.4"/><path d="M8 3v4.7"/><path d="M10 3v4.4"/>
    <path d="M6 7.3a2 2 0 0 0 4 0"/>
    <path d="M8 7.7V21"/>
    <path d="M16.4 3c-1.6 0-2.6 2.6-2.6 5.1 0 1.85 1.15 2.5 2.6 2.5s2.6-.65 2.6-2.5c0-2.5-1-5.1-2.6-5.1z"/>
    <path d="M16.4 10.6V21"/>`,
  交通: `
    <rect x="5" y="3.5" width="14" height="15" rx="3"/><path d="M5 11.5h14"/>
    <circle cx="8.4" cy="14.9" r="0.95"/><circle cx="15.6" cy="14.9" r="0.95"/>
    <path d="M7.6 18.5v1.9"/><path d="M16.4 18.5v1.9"/>`,
  购物: `
    <path d="M4.6 7.8h14.8l-1.05 11.7a1.6 1.6 0 0 1-1.6 1.5H7.3a1.6 1.6 0 0 1-1.6-1.5L4.6 7.8z"/>
    <path d="M8.2 8.2V6.1a3.8 3.8 0 0 1 7.6 0v2.1"/>`,
  生活: `
    <path d="M4.5 11 12 4.8l7.5 6.2"/>
    <path d="M6.6 9.6v9.7a.9.9 0 0 0 .9.9h9a.9.9 0 0 0 .9-.9V9.6"/>
    <path d="M10 20.2v-4.6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4.6"/>`,
  旅行: `
    <path d="M20.4 4 3.2 11.8a.45.45 0 0 0 .03.85l6.7 2.25"/>
    <path d="m9.93 14.9 2.25 6.7a.45.45 0 0 0 .85.03L20.4 4z"/>
    <path d="M9.93 14.9 20.4 4z"/>`,
  文娱: `
    <path d="M8 7.5h8a5 5 0 0 1 4.95 4.25l.55 3.9a2.7 2.7 0 0 1-5.02 1.5l-.6-1.25a2.1 2.1 0 0 0-1.9-1.2H10.02a2.1 2.1 0 0 0-1.9 1.2l-.6 1.25a2.7 2.7 0 0 1-5.02-1.5l.55-3.9A5 5 0 0 1 8 7.5z"/>
    <path d="M7 10.3v3.4"/><path d="M5.3 12h3.4"/>
    <circle cx="16" cy="11.1" r="1" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="12.9" r="1" fill="currentColor" stroke="none"/>`,
  转账: `
    <path d="M4.5 8.2h12"/><path d="m13 4.9 3.5 3.3L13 11.6"/>
    <path d="M19.5 15.8h-12"/><path d="M11 12.4 7.5 15.8 11 19.2"/>`,
  其他: `
    <circle cx="6.4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="17.6" cy="12" r="1.5" fill="currentColor" stroke="none"/>`,
  职业收入: `
    <rect x="3.5" y="7.5" width="17" height="12.2" rx="2.4"/>
    <path d="M8.6 7.5V6a2 2 0 0 1 2-2h2.8a2 2 0 0 1 2 2v1.5"/>
    <path d="M3.5 12.4h17"/><path d="M10.8 12.4h2.4"/>`,
  投资与资产: `
    <path d="M4 16.6 9.5 11l3 3L20 6.4"/><path d="M15 6.4h5v5"/>`,
  意外收入: `
    <rect x="4" y="9" width="16" height="4" rx="1"/>
    <path d="M5.3 13v6.6a1 1 0 0 0 1 1h11.4a1 1 0 0 0 1-1V13"/>
    <path d="M12 9v11.6"/>
    <path d="M12 9c0 0-1-4-3.2-3.7C7.2 5.5 7.6 8.2 9.3 8.8 10.4 9.1 12 9 12 9z"/>
    <path d="M12 9c0 0 1-4 3.2-3.7C16.8 5.5 16.4 8.2 14.7 8.8 13.6 9.1 12 9 12 9z"/>`,
  储值: `
    <rect x="3.5" y="6.5" width="17" height="12" rx="2.6"/>
    <path d="M14.4 11.2h6.1v3.1h-6.1a1.55 1.55 0 0 1 0-3.1z"/>
    <circle cx="16.6" cy="12.75" r="0.85" fill="currentColor" stroke="none"/>`,
  账户互转: `
    <path d="M5.4 11A6.6 6.6 0 0 1 17.2 7.6"/><path d="M13.4 7.4h4V3.4"/>
    <path d="M18.6 13A6.6 6.6 0 0 1 6.8 16.4"/><path d="M10.6 16.6h-4v4"/>`,
  赊销: `
    <rect x="3.5" y="6" width="17" height="12" rx="2.4"/>
    <path d="M3.5 9.8h17"/><path d="M6.6 14.5h3.2"/>`,
};
