/**
 * 主题 CSS 资源映射。
 *
 * 这里只负责把 id 映射到 CSS 字符串；元数据在 theme-catalog.ts。
 * 拆开是为了让 popup 不必打包这 9 套主题 CSS。
 */

import githubDocLight from 'github-markdown-css/github-markdown-light.css';
import githubDocDark from 'github-markdown-css/github-markdown-dark.css';

import hljsGithub from 'highlight.js/styles/github.css';
import hljsAtomOneLight from 'highlight.js/styles/atom-one-light.css';
import hljsXcode from 'highlight.js/styles/xcode.css';
import hljsStackoverflowLight from 'highlight.js/styles/stackoverflow-light.css';

import hljsGithubDark from 'highlight.js/styles/github-dark.css';
import hljsAtomOneDark from 'highlight.js/styles/atom-one-dark.css';
import hljsTokyoNightDark from 'highlight.js/styles/tokyo-night-dark.css';
import hljsNord from 'highlight.js/styles/nord.css';
import hljsMonokai from 'highlight.js/styles/monokai.css';

import type { Appearance } from './theme-catalog';

const HLJS_CSS: Record<string, string> = {
  'atom-one-light': hljsAtomOneLight,
  'stackoverflow-light': hljsStackoverflowLight,
  xcode: hljsXcode,
  github: hljsGithub,

  'atom-one-dark': hljsAtomOneDark,
  'github-dark': hljsGithubDark,
  'tokyo-night-dark': hljsTokyoNightDark,
  nord: hljsNord,
  monokai: hljsMonokai,
};

export function cssForTheme(id: string): string {
  return HLJS_CSS[id] ?? hljsAtomOneLight;
}

export const DOC_CSS: Record<Appearance, string> = {
  light: githubDocLight,
  dark: githubDocDark,
};
