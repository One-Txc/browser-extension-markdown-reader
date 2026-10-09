/**
 * 侧边目录：构建 + 滚动高亮。
 *
 * 高亮用 scroll 事件 + requestAnimationFrame 节流，而不是 IntersectionObserver。
 * 原因：IO 只在元素「进入/离开」观察区时回调，维护「当前章节」需要自己拼状态；
 * 而计算「最后一个已越过顶部基准线的标题」用位置比较更直接也更准。
 */

import { TOC_WIDTH, clampTocWidth } from '../shared/settings';
import { SOURCE_MODE_CLASS } from '../shared/const';

const HEADING_SELECTOR = 'h1, h2, h3, h4';
/** 只要有标题就生成目录（0 个标题时自然返回 null） */
const MIN_HEADINGS = 1;
/**
 * 判定「已越过顶部基准线」的偏移量。
 *
 * 与 app.css 里的 `scroll-margin-top` 是一对：跳转后标题停在距顶 10px 处，
 * 而高亮判定线放在更下方，让标题刚进入视口上部就切换高亮，滚动时更跟手。
 */
const TOP_OFFSET = 96;

export interface TocHandle {
  nav: HTMLElement;
  destroy(): void;
}

/** 取标题纯文本，去掉 markdown-it-anchor 插入的 permalink 符号 */
function headingText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.header-anchor').forEach((n) => n.remove());
  return (clone.textContent ?? '').trim();
}

export function buildToc(root: HTMLElement, minHeadings = MIN_HEADINGS): TocHandle | null {
  const headings = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).filter(
    (h) => h.id
  );
  if (headings.length < minHeadings) return null;

  const nav = document.createElement('nav');
  nav.className = 'md-reader-toc';
  nav.setAttribute('aria-label', '目录');

  const title = document.createElement('div');
  title.className = 'md-reader-toc-title';
  title.textContent = '目录';
  nav.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'md-reader-toc-list';

  const links = new Map<string, HTMLAnchorElement>();

  for (const heading of headings) {
    const item = document.createElement('li');
    // class 形如 toc-level-h2，与 app.css 中的缩进规则对应
    item.className = `toc-level-${heading.tagName.toLowerCase()}`;

    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.textContent = headingText(heading);
    link.title = link.textContent;
    link.addEventListener('click', (event) => {
      event.preventDefault();

      // 原文视图下目录只用于了解结构，不参与跳转。
      // CSS 那边已经设了 pointer-events:none，这里再拦一道，
      // 防止用户用键盘聚焦链接后回车触发。
      if (document.body.classList.contains(SOURCE_MODE_CLASS)) return;

      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 页面 URL 不变，锚点天然可用，这里只同步地址栏
      history.replaceState(null, '', `#${encodeURIComponent(heading.id)}`);
    });

    links.set(heading.id, link);
    item.appendChild(link);
    list.appendChild(item);
  }

  nav.appendChild(list);

  /* ------------------------------------------------------ 滚动高亮 */

  let currentId = '';
  let ticking = false;

  const setActive = (id: string): void => {
    if (id === currentId) return;
    currentId = id;

    links.forEach((link, key) => {
      link.classList.toggle('active', key === id);
    });

    // 让当前项保持可见
    const active = links.get(id);
    if (!active) return;
    const navBox = nav.getBoundingClientRect();
    const itemBox = active.getBoundingClientRect();
    if (itemBox.top < navBox.top + 12 || itemBox.bottom > navBox.bottom - 12) {
      active.scrollIntoView({ block: 'nearest' });
    }
  };

  const update = (): void => {
    ticking = false;
    if (!headings.length) return;

    /*
     * 原文视图下渲染内容被隐藏，标题元素没有布局盒，
     * getBoundingClientRect() 会全部返回 0 —— 于是「已越过顶部」这个判定
     * 对每个标题都成立，高亮会错误地停在最后一项。
     * 与其显示一个错的当前位置，不如清空高亮。
     */
    if (document.body.classList.contains(SOURCE_MODE_CLASS)) {
      setActive('');
      return;
    }

    let activeId = headings[0].id;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top - TOP_OFFSET <= 0) activeId = heading.id;
      else break;
    }

    // 已经滚到底部时，末尾的短章节永远越不过基准线，直接高亮最后一项
    const atBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) activeId = headings[headings.length - 1].id;

    setActive(activeId);
  };

  const onScroll = (): void => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  // 视图切换只改 body 的 class，不会触发 scroll/resize，
  // 所以额外盯一下 class 变化，让高亮在切换的那一刻就更新
  const classObserver = new MutationObserver(() => update());
  classObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  update();

  return {
    nav,
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      classObserver.disconnect();
    },
  };
}

export interface TocHandlers {
  /** 读取当前目录宽度 */
  getWidth(): number;
  /** 应用目录宽度；commit 为 true 表示拖拽结束，应当持久化 */
  setWidth(width: number, commit: boolean): void;
  /** 显示 / 隐藏目录 */
  setVisible(visible: boolean): void;
}

/** 窄屏阈值，必须与 app.css 里的媒体查询保持一致 */
const NARROW_QUERY = '(max-width: 1279px)';

function isNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

/** 目录与内容之间的拖拽手柄 */
function createResizer(handlers: TocHandlers): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'md-reader-resizer';
  bar.setAttribute('role', 'separator');
  bar.setAttribute('aria-orientation', 'vertical');
  bar.title = '拖动调整目录宽度，双击恢复默认';

  let dragging = false;
  let latest = handlers.getWidth();

  bar.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    latest = handlers.getWidth();
    bar.setPointerCapture(event.pointerId);
    bar.classList.add('is-dragging');
    // 拖拽期间禁止选中文本，否则会把正文整片刷蓝
    document.documentElement.classList.add('md-reader-resizing');
  });

  bar.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    latest = clampTocWidth(event.clientX);
    handlers.setWidth(latest, false);
  });

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('is-dragging');
    document.documentElement.classList.remove('md-reader-resizing');
    try {
      bar.releasePointerCapture(event.pointerId);
    } catch {
      /* 指针已经释放，忽略 */
    }
    // 只在松手时落盘，拖拽过程中不写 storage
    handlers.setWidth(latest, true);
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  bar.addEventListener('dblclick', () => {
    handlers.setWidth(TOC_WIDTH.default, true);
  });

  return bar;
}

/** 左上角按钮：显示 / 隐藏目录 */
function createTocButton(handlers: TocHandlers): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'md-reader-btn md-reader-btn-toc';
  button.textContent = '☰';
  button.title = '显示 / 隐藏目录';
  button.setAttribute('aria-label', '显示 / 隐藏目录');

  button.addEventListener('click', () => {
    // 窄屏下目录是覆盖式抽屉，开合属于临时状态，不去改持久化的设置
    if (isNarrow()) {
      document.body.classList.toggle('md-reader-toc-open');
      return;
    }
    handlers.setVisible(!document.body.classList.contains('md-reader-has-toc'));
  });

  return button;
}

/**
 * 构建并挂载目录、拖拽手柄与目录开关。
 * 返回 null 表示文档没有标题、不生成目录（此时也不会有按钮）。
 */
export function mountToc(root: HTMLElement, handlers: TocHandlers): TocHandle | null {
  const handle = buildToc(root);
  if (!handle) return null;

  const resizer = createResizer(handlers);
  const button = createTocButton(handlers);

  document.body.append(handle.nav, resizer, button);

  return {
    nav: handle.nav,
    destroy() {
      handle.destroy();
      resizer.remove();
      button.remove();
      handle.nav.remove();
      document.body.classList.remove('md-reader-has-toc', 'md-reader-toc-open');
    },
  };
}
