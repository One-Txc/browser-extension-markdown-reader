/**
 * 侧边目录：构建 + 滚动高亮。
 *
 * 高亮用 scroll 事件 + requestAnimationFrame 节流，而不是 IntersectionObserver。
 * 原因：IO 只在元素「进入/离开」观察区时回调，维护「当前章节」需要自己拼状态；
 * 而计算「最后一个已越过顶部基准线的标题」用位置比较更直接也更准。
 */

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
  update();

  return {
    nav,
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    },
  };
}

/**
 * 构建并挂载目录。
 * 返回 null 表示内容太短、不生成目录。
 */
export function mountToc(root: HTMLElement): TocHandle | null {
  const handle = buildToc(root);
  if (!handle) return null;

  document.body.appendChild(handle.nav);
  document.body.classList.add('md-reader-has-toc');

  // 窄屏下的抽屉开关
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'md-reader-toc-toggle';
  toggle.setAttribute('aria-label', '目录');
  toggle.textContent = '☰';
  toggle.addEventListener('click', () => {
    document.body.classList.toggle('md-reader-toc-open');
  });
  document.body.appendChild(toggle);

  return {
    nav: handle.nav,
    destroy() {
      handle.destroy();
      toggle.remove();
      handle.nav.remove();
      document.body.classList.remove('md-reader-has-toc', 'md-reader-toc-open');
    },
  };
}
