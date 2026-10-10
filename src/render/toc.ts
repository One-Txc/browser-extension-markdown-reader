/**
 * 侧边目录：树形构建 + 折叠 + 滚动高亮。
 *
 * ★ 为了支持折叠，目录从「扁平列表 + CSS 缩进」改成了真正的嵌套树。
 * 折叠的前提是知道父子关系，而 CSS 的 padding-left 缩进并不携带这层信息 ——
 * 它只是看起来有层级，结构上仍然是平级的兄弟节点。
 *
 * 高亮用 scroll 事件 + requestAnimationFrame 节流，而不是 IntersectionObserver。
 * 原因：IO 只在元素「进入/离开」观察区时回调，维护「当前章节」需要自己拼状态；
 * 而计算「最后一个已越过顶部基准线的标题」用位置比较更直接也更准。
 */

import { TOC_WIDTH, clampTocWidth } from '../shared/settings';
import { SOURCE_MODE_CLASS } from '../shared/const';

/*
 * 收录到 H6。
 * 过去只到 H4 是担心目录过长，但现在有了折叠，深度不再是问题 ——
 * 收起到浅层就能只看骨架。
 */
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
/** 只要有标题就生成目录（0 个标题时自然返回 null） */
const MIN_HEADINGS = 1;
/**
 * 判定「已越过顶部基准线」的偏移量。
 *
 * 与 app.css 里的 `scroll-margin-top` 是一对：跳转后标题停在距顶 10px 处，
 * 而高亮判定线放在更下方，让标题刚进入视口上部就切换高亮，滚动时更跟手。
 */
const TOP_OFFSET = 96;
/** 批量展开 / 收起最多提供几个层级 */
const MAX_BULK_LEVELS = 3;
/** 挂在 nav 上表示「不启用折叠」，由 CSS 收起 caret 与批量按钮 */
const NO_FOLD_CLASS = 'md-reader-toc-no-fold';

export interface TocHandle {
  nav: HTMLElement;
  /** 目录项总数，供调用方决定是否启用折叠功能 */
  count: number;
  /** 动态开关折叠功能（短文档不需要，长了才显示） */
  setFoldEnabled(enabled: boolean): void;
  /**
   * 按层数重置展开状态：N 表示「展开第 N 层」，即第 N 层及更浅的节点展开、
   * 更深的一律收起（可见 N+1 层）；传 -1 表示全部展开。
   */
  expandToLevel(level: number): void;
  destroy(): void;
}

interface TocNode {
  id: string;
  /** 标题层级，1 = h1 */
  level: number;
  /** 在目录树中的深度，根节点为 0 */
  depth: number;
  text: string;
  heading: HTMLElement;
  parent: TocNode | null;
  children: TocNode[];
  li: HTMLLIElement;
  caret: HTMLButtonElement | null;
  expanded: boolean;
}

/** 取标题纯文本，去掉 markdown-it-anchor 插入的 permalink 符号 */
function headingText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.header-anchor').forEach((n) => n.remove());
  return (clone.textContent ?? '').trim();
}

/**
 * 按标题层级建树。
 * 用栈维护「当前的祖先链」：遇到不深于栈顶的层级就先弹栈，剩下的栈顶就是父节点。
 */
function buildTree(headings: HTMLElement[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1));

    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;

    const node: TocNode = {
      id: heading.id,
      level,
      depth: parent ? parent.depth + 1 : 0,
      text: headingText(heading),
      heading,
      parent,
      children: [],
      li: document.createElement('li'),
      caret: null,
      expanded: true,
    };

    if (parent) parent.children.push(node);
    else roots.push(node);

    stack.push(node);
  }

  return roots;
}

function flattenTree(nodes: TocNode[], out: TocNode[] = []): TocNode[] {
  for (const node of nodes) {
    out.push(node);
    flattenTree(node.children, out);
  }
  return out;
}

function setNodeExpanded(node: TocNode, expanded: boolean): void {
  node.expanded = expanded;
  node.li.classList.toggle('is-collapsed', !expanded);
  // 箭头方向由 CSS 依据 is-collapsed 旋转，这里只同步无障碍状态
  node.caret?.setAttribute('aria-expanded', String(expanded));
}

function renderTree(
  nodes: TocNode[],
  list: HTMLUListElement,
  links: Map<string, HTMLAnchorElement>,
  onToggle: () => void
): void {
  for (const node of nodes) {
    const { li } = node;
    li.className = `toc-node toc-level-h${node.level}`;

    const row = document.createElement('div');
    row.className = 'toc-row';

    if (node.children.length > 0) {
      const caret = document.createElement('button');
      caret.type = 'button';
      caret.className = 'toc-caret';
      caret.title = '展开 / 收起子标题';
      caret.setAttribute('aria-label', '展开 / 收起子标题');
      caret.setAttribute('aria-expanded', 'true');
      /*
       * 用内联 SVG 而不是 ▾ / ▸ 字符。
       * 那两个字形本身就叫 SMALL TRIANGLE（U+25BE / U+25B8），
       * 小字号下笔画极细，且不同字体的渲染尺寸差异很大。
       * 方向切换交给 CSS 旋转，这里只生成一个固定的 V 形。
       */
      caret.innerHTML =
        '<svg viewBox="0 0 10 10" width="12" height="12" aria-hidden="true">' +
        '<path d="M2 3.4 L5 6.6 L8 3.4" fill="none" stroke="currentColor" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
      caret.addEventListener('click', (event) => {
        event.stopPropagation();
        setNodeExpanded(node, !node.expanded);
        // 手动折叠也要让批量按钮的状态跟着变，否则按钮会显示成过期的状态
        onToggle();
      });
      node.caret = caret;
      row.appendChild(caret);
    } else {
      // 没有子标题也占一个位置，保证同级条目的文字左边缘对齐
      const spacer = document.createElement('span');
      spacer.className = 'toc-caret toc-caret-empty';
      row.appendChild(spacer);
    }

    const link = document.createElement('a');
    link.href = `#${node.id}`;
    link.textContent = node.text;
    link.title = node.text;
    link.addEventListener('click', (event) => {
      event.preventDefault();

      // 原文视图下目录只用于了解结构，不参与跳转。
      // CSS 那边已经设了 pointer-events:none，这里再拦一道，
      // 防止用户用键盘聚焦链接后回车触发。
      if (document.body.classList.contains(SOURCE_MODE_CLASS)) return;

      node.heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 页面 URL 不变，锚点天然可用，这里只同步地址栏
      history.replaceState(null, '', `#${encodeURIComponent(node.id)}`);
    });

    links.set(node.id, link);
    row.appendChild(link);
    li.appendChild(row);

    if (node.children.length > 0) {
      const childList = document.createElement('ul');
      childList.className = 'toc-children';
      renderTree(node.children, childList, links, onToggle);
      li.appendChild(childList);
    }

    list.appendChild(li);
  }
}

/**
 * 把某一层级整体展开或收起。
 *
 * 展开时顺带把更浅的层级也展开 —— 否则目标层级藏在收起的父节点里，
 * 点了「展开 H2」却什么都看不到。
 */
function applyLevel(nodes: TocNode[], level: number, expanded: boolean): void {
  for (const node of nodes) {
    if (node.level === level) {
      setNodeExpanded(node, expanded);
    } else if (expanded && node.level < level) {
      setNodeExpanded(node, true);
    }
  }
}

/**
 * 批量展开 / 收起按钮条。
 *
 * 层级取自「文档中实际出现过的层级」并按数字升序取前三个 ——
 * 不是写死的 H1/H2/H3。若文档只有 H2 和 H3，这两个就分别是第 1、2 级。
 * 某一层级若没有任何带子标题的节点，则不生成按钮（点了也没有效果）。
 */
function createBulkBar(nodes: TocNode[]): { bar: HTMLElement | null; refresh: () => void } {
  const levels = [...new Set(nodes.map((n) => n.level))]
    .sort((a, b) => a - b)
    .slice(0, MAX_BULK_LEVELS);

  const targets = (level: number): TocNode[] =>
    nodes.filter((n) => n.level === level && n.children.length > 0);

  const bar = document.createElement('div');
  bar.className = 'md-reader-toc-bulk';
  const buttons = new Map<number, HTMLButtonElement>();

  const refresh = (level: number): void => {
    const button = buttons.get(level);
    const list = targets(level);
    if (!button || list.length === 0) return;

    const allExpanded = list.every((n) => n.expanded);
    const allCollapsed = list.every((n) => !n.expanded);

    button.classList.toggle('is-expanded', allExpanded);
    button.classList.toggle('is-mixed', !allExpanded && !allCollapsed);
    button.title = allExpanded ? `收起所有 H${level} 标题` : `展开所有 H${level} 标题`;
  };

  const refreshAll = (): void => {
    for (const level of levels) refresh(level);
  };

  for (const level of levels) {
    if (targets(level).length === 0) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-bulk-btn';
    button.textContent = `H${level}`;
    button.addEventListener('click', () => {
      const list = targets(level);
      const allExpanded = list.every((n) => n.expanded);
      applyLevel(nodes, level, !allExpanded);
      refreshAll();
    });

    buttons.set(level, button);
    bar.appendChild(button);
  }

  refreshAll();
  // 即使一个按钮都没生成，也返回一个 no-op 的 refresh，调用方不必判空
  return { bar: buttons.size > 0 ? bar : null, refresh: refreshAll };
}

export function buildToc(
  root: HTMLElement,
  minHeadings = MIN_HEADINGS,
  handlers?: TocHandlers
): TocHandle | null {
  const headings = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).filter(
    (h) => h.id
  );
  if (headings.length < minHeadings) return null;

  const nav = document.createElement('nav');
  nav.className = 'md-reader-toc';
  nav.setAttribute('aria-label', '侧边栏');

  /*
   * 顶部是 tab 条：目录 / 文件夹。
   * 「文件夹」面板由外部通过 handlers 提供 —— 目录树与文件夹是两个独立功能，
   * 不该让 toc.ts 反过来依赖 folder.ts。
   */
  const folderPane = handlers?.createFolderPane?.() ?? null;

  const tabs = document.createElement('div');
  tabs.className = 'md-reader-tabs';

  const outlinePane = document.createElement('div');
  outlinePane.className = 'md-reader-pane';
  outlinePane.dataset.pane = 'outline';

  const folderPaneWrap = document.createElement('div');
  folderPaneWrap.className = 'md-reader-pane md-reader-hidden';
  folderPaneWrap.dataset.pane = 'folder';

  const makeTab = (pane: string, label: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-reader-tab';
    btn.dataset.pane = pane;
    btn.textContent = label;
    return btn;
  };

  const outlineTab = makeTab('outline', '目录');
  tabs.append(outlineTab);
  if (folderPane) {
    tabs.append(makeTab('folder', '文件夹'));
    folderPaneWrap.append(folderPane);
  }

  const switchPane = (pane: string): void => {
    for (const tab of tabs.querySelectorAll<HTMLElement>('.md-reader-tab')) {
      tab.classList.toggle('is-active', tab.dataset.pane === pane);
    }
    for (const p of nav.querySelectorAll<HTMLElement>('.md-reader-pane')) {
      p.classList.toggle('md-reader-hidden', p.dataset.pane !== pane);
    }
  };

  tabs.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('.md-reader-tab');
    if (btn?.dataset.pane) switchPane(btn.dataset.pane);
  });

  nav.append(tabs, outlinePane);
  if (folderPane) nav.append(folderPaneWrap);
  switchPane('outline');

  const tree = buildTree(headings);
  const nodes = flattenTree(tree);
  const links = new Map<string, HTMLAnchorElement>();

  const bulk = createBulkBar(nodes);
  if (bulk.bar) outlinePane.appendChild(bulk.bar);

  const list = document.createElement('ul');
  list.className = 'md-reader-toc-list';
  renderTree(tree, list, links, bulk.refresh);
  outlinePane.appendChild(list);

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

  /*
   * 首次高亮延后一帧再算。
   *
   * update() 里的 getBoundingClientRect 会强制浏览器做一次完整的样式计算与布局，
   * 而此刻我们刚注入 60–80KB 的 CSS。实测这一步能占掉上百毫秒，
   * 若压在「恢复可见」之前，用户就要多等这么久才能看到内容。
   * 延后一帧的代价仅仅是高亮晚一帧出现，人眼无感。
   */
  requestAnimationFrame(() => update());

  /*
   * 折叠 UI（caret 与批量按钮）始终生成，是否显示由这个开关控制。
   * 这样阈值设置变化时可以即时切换，不必重建目录 ——
   * 重建会让折叠状态和目录自身的滚动位置全部丢失。
   */
  const setFoldEnabled = (enabled: boolean): void => {
    nav.classList.toggle(NO_FOLD_CLASS, !enabled);
    if (enabled) return;
    // 关掉折叠时把所有节点展开，否则残留的收起状态会让一部分条目彻底看不见
    for (const node of nodes) setNodeExpanded(node, true);
    bulk.refresh();
  };

  /** 按层数重置展开状态；-1 表示全部展开 */
  const expandToLevel = (level: number): void => {
    for (const node of nodes) {
      // 深度小于 level 的节点展开 —— 这样第 level 层可见，但它自身是收起的
      setNodeExpanded(node, level < 0 || node.depth < level);
    }
    // 展开状态变了，批量按钮的三态显示也要跟着更新
    bulk.refresh();
  };

  return {
    nav,
    count: headings.length,
    setFoldEnabled,
    expandToLevel,
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
  /**
   * 创建「文件夹」面板的内容。
   * 返回 null 或不实现时，只显示「目录」一个 tab（保持原样）。
   *
   * 之所以从这里回调而不是由 toc.ts 直接依赖 folder.ts：
   * 目录树与文件夹是两个独立功能，不该互相 import。
   */
  createFolderPane?(): HTMLElement | null;
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
  const handle = buildToc(root, MIN_HEADINGS, handlers);
  if (!handle) return null;

  const resizer = createResizer(handlers);
  const button = createTocButton(handlers);

  document.body.append(handle.nav, resizer, button);

  const destroyInner = handle.destroy;

  return {
    nav: handle.nav,
    count: handle.count,
    setFoldEnabled: handle.setFoldEnabled,
    expandToLevel: handle.expandToLevel,
    destroy() {
      destroyInner();
      resizer.remove();
      button.remove();
      handle.nav.remove();
      document.body.classList.remove('md-reader-has-toc', 'md-reader-toc-open');
    },
  };
}
