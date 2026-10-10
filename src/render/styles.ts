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
  isEyeCareMode,
  type ReaderSettings,
  type ThemeMode,
} from '../shared/settings';
import appCss from './app.css';
import katexCssRaw from 'katex/dist/katex.min.css';
import { STYLE_ID } from '../shared/const';

export type { ReaderSettings, ThemeMode };

/** 按设置解析出实际生效的外观（auto 时问系统） */
export function resolveAppearance(mode: ThemeMode): Appearance {
  // 暗夜暖调仍属深色系：滚动条、原生控件要跟着变深
  if (mode === 'dark' || mode === 'darkwarm') return 'dark';
  // 其余护眼配色都是浅色系的变体
  if (mode !== 'auto') return 'light';
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
   *
   * 供原文视图等**不在 .markdown-body 内**的文本使用 ——
   * <pre class="md-reader-source"> 是 body 的直接子元素，拿不到 .markdown-body 上的样式。
   *
   * 注意：github-markdown-css 把正文颜色**硬编码**在 .markdown-body 上，
   * 并不读这个变量。所以护眼配色还需要 app.css 里那段覆盖规则才能真正生效，
   * 见 EYE_CARE_MODES 的说明。
   */
  fg: string;
  /** 次要文字色（侧栏目录等小字辅助信息）。比 fg 浅，不要拿它当正文色 */
  muted: string;
  toc: { border: string; text: string; active: string };
  /** 代码块底色；不给则用代码主题自带的值 */
  codeBg?: string;
}

/** 调色板的键 —— auto 没有自己的值，它按系统解析成 light 或 dark */
type PaletteKey = Exclude<ThemeMode, 'auto'>;

const PALETTE: Record<PaletteKey, AppearancePalette> = {
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

  /* ---------------- 护眼配色 ----------------
   *
   * 五套都只改「页面底色 + 文字色 + 边框/次要色 + 代码块底色」，
   * 代码语法高亮沿用现有的浅色主题（darkwarm 用深色主题）。
   */

  // 羊皮纸：最接近纸质书，暖度明显
  parchment: {
    pageBg: '#f7f1e1',
    codeBorder: 'rgba(120, 95, 50, 0.18)',
    fg: '#3c3528',
    muted: '#7a6c52',
    toc: { border: 'rgba(120, 95, 50, 0.16)', text: '#5a5140', active: '#9a5b13' },
    codeBg: '#efe6d0',
  },
  // 护眼模式（豆沙绿）
  eyecare: {
    pageBg: '#c7edcc',
    codeBorder: 'rgba(26, 90, 45, 0.20)',
    fg: '#24352a',
    muted: '#5a7561',
    toc: { border: 'rgba(26, 90, 45, 0.18)', text: '#3d5a45', active: '#1a7a3e' },
    codeBg: '#b6e0bd',
  },
  // 暖白：只是觉得纯白刺眼，变化最轻
  warmwhite: {
    pageBg: '#faf6ee',
    codeBorder: 'rgba(130, 105, 60, 0.16)',
    fg: '#3a352c',
    muted: '#7d7466',
    toc: { border: 'rgba(130, 105, 60, 0.14)', text: '#5f584c', active: '#a15c14' },
    codeBg: '#f2ece0',
  },
  // 柔灰：只降对比、不改变色相
  softgray: {
    pageBg: '#ecebe6',
    codeBorder: 'rgba(0, 0, 0, 0.10)',
    fg: '#333333',
    muted: '#6b6b66',
    toc: { border: 'rgba(0, 0, 0, 0.09)', text: '#4a4a46', active: '#0b6bcb' },
    codeBg: '#e2e1db',
  },
  // 暗夜暖调：夜间用，比纯深色柔和、无冷蓝感
  darkwarm: {
    pageBg: '#1c1917',
    codeBorder: 'rgba(255, 255, 255, 0.10)',
    fg: '#d6cbb8',
    muted: '#8f8577',
    toc: { border: 'rgba(255, 255, 255, 0.09)', text: '#a89c88', active: '#e0a458' },
    codeBg: '#262220',
  },
};

/** 按 mode 取调色板；auto 先问系统，再取对应的基础明暗 */
function resolvePalette(mode: ThemeMode): AppearancePalette {
  return PALETTE[mode === 'auto' ? resolveAppearance(mode) : mode];
}

/** 组装完整的样式表 */
export function buildThemeCss(settings: ReaderSettings): string {
  const appearance = resolveAppearance(settings.mode);
  const theme = findTheme(
    appearance === 'dark' ? settings.darkTheme : settings.lightTheme,
    appearance
  );
  const palette = resolvePalette(settings.mode);
  // 护眼配色自带代码块底色：冷灰的 GitHub Light 底色放在米黄页面上会很突兀
  const codeBg = palette.codeBg ?? theme.codeBg;

  const vars = [
    ':root {',
    `  --md-code-bg: ${codeBg};`,
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

  /*
   * 护眼配色还需要 app.css 里那段正文覆盖规则才能真正生效 ——
   * github-markdown-css 把正文颜色硬编码在 .markdown-body 上，不读我们的变量。
   *
   * 用单个属性标记，而不是把那段 CSS 的选择器写成五个
   * [data-md-reader-palette="…"]，这样以后加配色不必再改样式。
   */
  if (isEyeCareMode(settings.mode)) {
    doc.documentElement.dataset.mdReaderEyeCare = '';
  } else {
    delete doc.documentElement.dataset.mdReaderEyeCare;
  }
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
