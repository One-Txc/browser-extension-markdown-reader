/**
 * 主题样式组装与注入。
 *
 * CSS 全部由 esbuild 的 text loader 打包成字符串，运行时写进一个 <style>。
 * 切换主题/字号只替换这个 <style> 的内容，不需要重新渲染 Markdown。
 */

import { DOC_CSS, cssForTheme } from './themes';
import { findTheme, type Appearance } from './theme-catalog';
import {
  CONTENT_WIDTH_PX,
  FONT_SIZE_PX,
  clampTocWidth,
  type ReaderSettings,
  type ThemeMode,
} from '../shared/settings';
import appCss from './app.css';
import katexCssRaw from 'katex/dist/katex.min.css';
import { STYLE_ID } from '../shared/const';

export type { ReaderSettings, ThemeMode };

/** 按设置解析出实际生效的外观（auto 时问系统） */
export function resolveAppearance(mode: ThemeMode): Appearance {
  if (mode === 'light' || mode === 'dark') return mode;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

interface AppearancePalette {
  /** 页面背景 */
  pageBg: string;
  /** 代码块边框 */
  codeBorder: string;
  /**
   * 正文前景色。
   * 供原文视图等**不在 .markdown-body 内**的文本使用 ——
   * github-markdown-css 的 --fgColor-default 只定义在 .markdown-body 作用域上，
   * 外部的 <pre class="md-reader-source"> 拿不到它。
   */
  fg: string;
  /** 次要文字色（侧栏目录等小字辅助信息）。比 fg 浅，不要拿它当正文色 */
  muted: string;
  toc: { border: string; text: string; active: string };
}

const PALETTE: Record<Appearance, AppearancePalette> = {
  light: {
    pageBg: '#ffffff',
    codeBorder: 'rgba(0, 0, 0, 0.06)',
    // 与 github-markdown-css 浅色主题的正文色保持一致
    fg: '#1f2328',
    muted: '#656d76',
    /*
     * 大纲是主要导航，不是「次要文字」，所以不用 muted 那个灰。
     * 也不能直接用 fg 的 #1f2328 —— 那会让大纲与正文一样重、抢走视觉重心，
     * 所以取一个明显更深、但仍与正文有区分的等级。
     */
    toc: { border: 'rgba(0, 0, 0, 0.08)', text: '#424a53', active: '#0969da' },
  },
  dark: {
    pageBg: '#0d1117',
    codeBorder: 'rgba(255, 255, 255, 0.10)',
    // 不用纯白：深色背景上的纯白有明显光晕，长时间阅读刺眼
    fg: '#e6edf3',
    muted: '#8b949e',
    toc: { border: 'rgba(255, 255, 255, 0.10)', text: '#8b949e', active: '#58a6ff' },
  },
};

/** 组装完整的样式表 */
export function buildThemeCss(settings: ReaderSettings): string {
  const appearance = resolveAppearance(settings.mode);
  const theme = findTheme(
    appearance === 'dark' ? settings.darkTheme : settings.lightTheme,
    appearance
  );
  const palette = PALETTE[appearance];

  const vars = [
    ':root {',
    `  --md-code-bg: ${theme.codeBg};`,
    `  --md-page-bg: ${palette.pageBg};`,
    `  --md-code-border: ${palette.codeBorder};`,
    `  --md-fg: ${palette.fg};`,
    `  --md-muted: ${palette.muted};`,
    `  --md-font-size: ${FONT_SIZE_PX[settings.fontSize]};`,
    `  --md-content-width: ${CONTENT_WIDTH_PX[settings.contentWidth]};`,
    `  --md-toc-border: ${palette.toc.border};`,
    `  --md-toc-text: ${palette.toc.text};`,
    `  --md-toc-active: ${palette.toc.active};`,
    `  --md-toc-width: ${clampTocWidth(settings.tocWidth)}px;`,
    `  color-scheme: ${appearance};`,
    '}',
  ].join('\n');

  // 顺序要紧：文档样式 → 代码主题 → 变量覆盖 → 本项目补充样式
  return [DOC_CSS[appearance], cssForTheme(theme.id), vars, appCss].join('\n\n');
}

/** 幂等注入 / 更新样式 */
export function applyTheme(doc: Document, settings: ReaderSettings): void {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  style.textContent = buildThemeCss(settings);

  // 供按需注入的 Mermaid bundle 读取：它跑在页面 world，与 content script
  // 的 JS 作用域隔离，只能通过 DOM 传递当前外观。
  doc.documentElement.dataset.mdReaderAppearance = resolveAppearance(settings.mode);
}

const KATEX_STYLE_ID = 'md-reader-katex';

/**
 * 按需注入 KaTeX 样式（仅当文档确实含公式时才调用，省下每次 25KB 的注入）。
 *
 * ★ 字体 URL 必须重写成扩展内的绝对地址。
 * KaTeX 的 CSS 里写的是 `url(fonts/KaTeX_*.woff2)`，这份 CSS 是内联进
 * file:// 页面的，相对路径会按**页面所在目录**解析 —— 直接指向用户的文档目录，
 * 必然 404，公式会退化成回退字体、符号错乱。
 */
export function injectKatexCss(doc: Document): void {
  if (doc.getElementById(KATEX_STYLE_ID)) return;

  const fontBase = chrome.runtime.getURL('build/fonts/');
  const style = doc.createElement('style');
  style.id = KATEX_STYLE_ID;
  style.textContent = katexCssRaw.replace(/url\((['"]?)fonts\//g, `url($1${fontBase}`);
  (doc.head ?? doc.documentElement).appendChild(style);
}
