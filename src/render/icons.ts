/**
 * 面板之间共用的图标。
 *
 * 目前有两个面板（文件夹 / 历史）都要用「Markdown 文件」和「在新标签页打开」
 * 这两枚图标，放在这里供两边 import，省得同一份 SVG 抄两遍、改一处漏一处。
 *
 * 图标一律用 currentColor，深浅主题自动跟随。
 */

/** Markdown 文件：圆角卡片 + M */
export const ICON_MD = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linejoin="round"><rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.8" stroke-width="1.35"/><path d="M5.3 10.9V6.1l2.7 3.3 2.7-3.3v4.8" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** 「在新标签页打开真实 URL」 */
export const ICON_JUMP = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H3.6a1.1 1.1 0 0 0-1.1 1.1v7.8a1.1 1.1 0 0 0 1.1 1.1h7.8a1.1 1.1 0 0 0 1.1-1.1V9.5"/><path d="M9.6 2.4h4v4"/><path d="M13.3 2.7 7.6 8.4"/></svg>`;

/*
 * 表格操作条的对齐图标。
 *
 * 用「三条横线」表达对齐方向：上、下两条撑满，中间那条按对齐方向缩进。
 * 这样在 14px 的按钮里也一眼能看出左右，比画一个居中的方块更直观。
 */
export const ICON_ALIGN_LEFT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4h12"/><path d="M2 8h7.5"/><path d="M2 12h12"/></svg>`;

export const ICON_ALIGN_CENTER = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4h12"/><path d="M4.25 8h7.5"/><path d="M2 12h12"/></svg>`;

export const ICON_ALIGN_RIGHT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4h12"/><path d="M6.5 8h7.5"/><path d="M2 12h12"/></svg>`;

/** 「自适应宽」：左右双向箭头，含义是「按内容宽度向两侧展开」 */
export const ICON_FIT_WIDTH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12"/><path d="M4.4 5.6 2 8l2.4 2.4"/><path d="M11.6 5.6 14 8l-2.4 2.4"/></svg>`;
