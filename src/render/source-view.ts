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

const PANEL_CLASS = 'md-reader-source';
const HIDDEN_CLASS = 'md-reader-hidden';
const SOURCE_MODE_CLASS = 'md-reader-source-mode';

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

    button.textContent = showingSource ? 'Aa' : '</>';
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
