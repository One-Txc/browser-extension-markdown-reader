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
