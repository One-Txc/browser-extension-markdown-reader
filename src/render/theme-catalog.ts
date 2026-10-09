/**
 * 主题目录（纯元数据，不含任何 CSS）。
 *
 * 单独成文件的原因：popup 只需要主题的名字和 id 来渲染下拉框，
 * 如果从 themes.ts 引入，会把 9 套 highlight.js 主题 CSS 全部打进 popup.js。
 * 拆开后 esbuild 可以干净地摇掉那一大坨字符串。
 */

export type Appearance = 'light' | 'dark';

export interface ThemeInfo {
  id: string;
  /** 设置界面显示名 */
  name: string;
  appearance: Appearance;
  /** 代码块容器背景色 */
  codeBg: string;
}

/**
 * 浅色代码块统一用同一个真正看得见的浅灰。
 *
 * 不用主题自带的背景色，是因为它们普遍是 #fff / #fafafa，
 * 落在白色文档上几乎看不出代码块边界（实测 #F6F8FA 对 #FFFFFF 的对比度约 1.02:1）。
 */
const LIGHT_CODE_BG = '#f1f3f5';

export const THEME_CATALOG: ThemeInfo[] = [
  { id: 'atom-one-light', name: 'Atom One Light', appearance: 'light', codeBg: LIGHT_CODE_BG },
  { id: 'stackoverflow-light', name: 'Stack Overflow Light', appearance: 'light', codeBg: LIGHT_CODE_BG },
  { id: 'xcode', name: 'Xcode', appearance: 'light', codeBg: LIGHT_CODE_BG },
  { id: 'github', name: 'GitHub Light（原配，配色偏淡）', appearance: 'light', codeBg: LIGHT_CODE_BG },

  { id: 'atom-one-dark', name: 'Atom One Dark', appearance: 'dark', codeBg: '#282c34' },
  { id: 'github-dark', name: 'GitHub Dark', appearance: 'dark', codeBg: '#161b22' },
  { id: 'tokyo-night-dark', name: 'Tokyo Night', appearance: 'dark', codeBg: '#1a1b26' },
  { id: 'nord', name: 'Nord', appearance: 'dark', codeBg: '#2e3440' },
  { id: 'monokai', name: 'Monokai', appearance: 'dark', codeBg: '#272822' },
];

export const DEFAULT_LIGHT_THEME = 'atom-one-light';
export const DEFAULT_DARK_THEME = 'atom-one-dark';

export function themesFor(appearance: Appearance): ThemeInfo[] {
  return THEME_CATALOG.filter((t) => t.appearance === appearance);
}

export function findTheme(id: string, appearance: Appearance): ThemeInfo {
  const pool = themesFor(appearance);
  return pool.find((t) => t.id === id) ?? pool[0] ?? THEME_CATALOG[0];
}
