/**
 * 原始 Markdown 与渲染视图的切换。
 *
 * 原始文本用 textContent 写入，不经过 innerHTML，天然免疫注入 ——
 * 展示源码不能成为新的 XSS 入口。
 *
 * ★ 显隐用 class + display:none!important，而不是 hidden 属性。
 * [hidden] 只是 UA 样式表里的一条 display:none，优先级的对手是作者样式表里
 * 任何一条匹配该元素的 display 声明（例如别的 Markdown 扩展注入的全局 pre 规则），
 * 被压过时切换原文就会看到一片空白。class + !important 不依赖这条 UA 规则。
 *
 * 进入原文视图时会通过 body class 关掉目录与拖拽手柄：
 * 此时页面里没有渲染后的标题元素，目录跳转与滚动高亮都会失效，留着只会误导。
 */

import { SOURCE_MODE_CLASS } from '../shared/const';

const PANEL_CLASS = 'md-reader-source';
const HIDDEN_CLASS = 'md-reader-hidden';

/*
 * 两个图标表示「点击后会看到的视图」：
 *   渲染中 → 显示花括号（提示可以切到源码）
 *   源码中 → 显示眼睛（提示可以切回渲染）
 *
 * 不用文字字形（原来的 </> 与 Aa）：Aa 依赖系统字体渲染，
 * 各家字形差异很大，15px 下容易糊，与旁边手绘的线条图标也不统一。
 */
const ICON_TO_SOURCE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 2.6c-1.6 0-1.9.9-1.9 2v1.7c0 1-.5 1.6-1.5 1.7 1 .1 1.5.7 1.5 1.7v1.7c0 1.1.3 2 1.9 2M9.6 2.6c1.6 0 1.9.9 1.9 2v1.7c0 1 .5 1.6 1.5 1.7-1 .1-1.5.7-1.5 1.7v1.7c0 1.1-.3 2-1.9 2"/></svg>`;

const ICON_TO_RENDERED = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.6 8S3.9 4 8 4s6.4 4 6.4 4-2.3 4-6.4 4S1.6 8 1.6 8Z"/><circle cx="8" cy="8" r="1.8"/></svg>`;

export interface SourceViewHandle {
  /** 当前是否正在显示原文 */
  isShowingSource(): boolean;
  destroy(): void;
}

export function setupSourceView(root: HTMLElement, raw: string): SourceViewHandle {
  const panel = document.createElement('pre');
  panel.className = PANEL_CLASS;
  panel.textContent = raw;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'md-reader-btn md-reader-btn-source';

  let showingSource = false;

  const sync = (): void => {
    panel.classList.toggle(HIDDEN_CLASS, !showingSource);
    root.classList.toggle(HIDDEN_CLASS, showingSource);
    document.body.classList.toggle(SOURCE_MODE_CLASS, showingSource);

    // 图标表达「点击后会看到的视图」
    button.innerHTML = showingSource ? ICON_TO_RENDERED : ICON_TO_SOURCE;
    button.title = showingSource ? '返回渲染视图' : '查看原始 Markdown';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(showingSource));
    button.classList.toggle('is-active', showingSource);
  };

  button.addEventListener('click', () => {
    showingSource = !showingSource;
    sync();
    // 两种视图的滚动位置没有对应关系，切换后回到顶部更不容易迷失
    window.scrollTo({ top: 0 });
  });

  document.body.append(panel, button);
  sync();

  return {
    isShowingSource: () => showingSource,
    destroy() {
      panel.remove();
      button.remove();
      document.body.classList.remove(SOURCE_MODE_CLASS);
    },
  };
}
