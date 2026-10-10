/**
 * 「文件夹」面板 —— 展示当前文档所在目录的内容。
 *
 * 数据来自 background 的 list-directory（原理见 shared/directory.ts）。
 *
 * 交互设计（与主流 Markdown 阅读器一致）：
 *   - 点文件夹   → 就地展开 / 收起，子目录按需加载
 *   - 点文档     → **原地替换正文，不改变 URL**，由 onOpen 回调实现
 *   - 右侧跳转图标 → 真正打开该 URL（新标签页），由 onNavigate 回调实现
 *
 * 「原地打开」是刻意的：切文档时侧边栏状态、滚动习惯都不该丢。
 * 但 URL 不变意味着它不再代表正文内容，所以必须给用户一个「真跳转」的出口，
 * 这就是那个跳转图标存在的理由。
 *
 * 其他要点：
 *   - 只显示目录与 Markdown 文件
 *   - 默认全部收起；文件夹图标随展开状态切换
 *   - 图标一律用 currentColor，深浅主题自动跟随
 */

import { directoryOf, resolveEntryUrl, type DirEntry } from '../shared/directory';

/* ------------------------------------------------------------------ 图标 */

/** 合上的文件夹（Lucide folder，ISC 许可） */
const ICON_FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;

/** 打开的文件夹（Lucide folder-open） */
const ICON_FOLDER_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>`;

/** Markdown 文件：圆角卡片 + M */
const ICON_MD = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linejoin="round"><rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.8" stroke-width="1.35"/><path d="M5.3 10.9V6.1l2.7 3.3 2.7-3.3v4.8" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** 展开 / 收起箭头，与目录 tab 用同一套 */
const ICON_CARET = `<svg viewBox="0 0 10 10"><path d="M2 3.4 L5 6.6 L8 3.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 「在新标签页打开真实 URL」 */
const ICON_JUMP = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H3.6a1.1 1.1 0 0 0-1.1 1.1v7.8a1.1 1.1 0 0 0 1.1 1.1h7.8a1.1 1.1 0 0 0 1.1-1.1V9.5"/><path d="M9.6 2.4h4v4"/><path d="M13.3 2.7 7.6 8.4"/></svg>`;

/* ------------------------------------------------------------------ 类型 */

export interface FolderPaneOptions {
  /** 当前文档的绝对 URL（首次挂载时的真实地址） */
  documentUrl: string;
  /**
   * 点击文档项时的回调 —— 由调用方决定如何展示（本项目的做法是原地替换正文）。
   * 不传则退化为直接导航。
   */
  onOpen?: (url: string) => void;
  /**
   * 点击行尾跳转图标时的回调 —— 真正打开该 URL。
   * 不传则默认新标签页打开。
   */
  onNavigate?: (url: string) => void;
}

export interface FolderPaneHandle {
  element: HTMLElement;
  /** 重新加载根目录 */
  reload(): void;
  /** 原地切换后更新选中项（传入当前正在显示的文档 URL） */
  setCurrent(url: string): void;
  destroy(): void;
}

interface DirNode {
  url: string;
  childrenEl: HTMLElement;
  caret: HTMLButtonElement;
  iconEl: HTMLElement;
  rowEl: HTMLElement;
  loaded: boolean;
  expanded: boolean;
}

/* ------------------------------------------------------------ 数据获取 */

async function fetchDirectory(
  dirUrl: string
): Promise<{ ok: boolean; entries?: DirEntry[]; error?: string }> {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'list-directory', url: dirUrl });
    return (
      (res as { ok: boolean; entries?: DirEntry[]; error?: string }) ?? {
        ok: false,
        error: '无响应',
      }
    );
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ------------------------------------------------------------ 面板实现 */

export function mountFolderPane(options: FolderPaneOptions): FolderPaneHandle {
  const rootDir = directoryOf(options.documentUrl);

  /** 当前「正在显示」的文档 URL —— 原地切换后由 setCurrent 更新 */
  let currentUrl = options.documentUrl;

  const nodes: DirNode[] = [];

  const bar = document.createElement('div');
  bar.className = 'md-reader-folder-bar';

  const barName = document.createElement('span');
  barName.className = 'name';
  const segs = rootDir.replace(/\/$/, '').split('/');
  barName.textContent = decodeURIComponent(segs[segs.length - 1] ?? '') || '/';

  const barCount = document.createElement('span');
  barCount.className = 'count';

  bar.append(barName, barCount);

  const list = document.createElement('ul');
  list.className = 'md-reader-folder-list';

  const scroll = document.createElement('div');
  scroll.className = 'md-reader-folder-scroll';
  scroll.append(list);

  const element = document.createElement('div');
  element.className = 'md-reader-folder';
  element.append(bar, scroll);

  /** 高亮当前正在显示的文档 */
  function applyCurrent(): void {
    const target = decodeURIComponent(currentUrl);
    for (const row of list.querySelectorAll<HTMLElement>('.folder-row')) {
      row.classList.toggle('is-current', row.dataset.url === target);
    }
    const active = list.querySelector('.is-current');
    if (active) requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest' }));
  }

  /** 渲染一行 */
  function renderRow(entry: DirEntry, parentUrl: string): HTMLElement {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'folder-row';
    const url = resolveEntryUrl(parentUrl, entry);
    row.dataset.url = decodeURIComponent(url);
    if (entry.isDir) row.classList.add('is-dir');

    // 1. 折叠箭头（仅目录；文件用等宽占位保证图标列对齐）
    let caret: HTMLButtonElement | null = null;
    if (entry.isDir) {
      caret = document.createElement('button');
      caret.type = 'button';
      caret.className = 'folder-caret is-collapsed';
      caret.title = '展开 / 收起';
      caret.setAttribute('aria-label', '展开 / 收起');
      caret.innerHTML = ICON_CARET;
      row.append(caret);
    } else {
      const pad = document.createElement('span');
      pad.className = 'folder-caret-empty';
      row.append(pad);
    }

    // 2. 类型图标
    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    if (entry.isDir) {
      if (entry.name.startsWith('.')) icon.classList.add('is-hidden-dir');
      icon.innerHTML = ICON_FOLDER;
    } else {
      icon.innerHTML = ICON_MD;
    }
    row.append(icon);

    // 3. 名称
    const label = document.createElement('span');
    label.className = 'folder-name';
    label.textContent = entry.name;
    row.append(label);

    // 4. 跳转图标：真正打开这个 URL（原地打开时 URL 不再代表正文，需要这个出口）
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'folder-jump';
    jump.title = entry.isDir ? '在新标签页打开该目录' : '在新标签页打开该文件';
    jump.setAttribute('aria-label', jump.title);
    jump.innerHTML = ICON_JUMP;
    jump.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (options.onNavigate) options.onNavigate(url);
      else window.open(url, '_blank');
    });
    row.append(jump);

    li.append(row);

    /* ---- 目录：子容器 + 懒加载 ---- */
    if (entry.isDir && caret) {
      const childList = document.createElement('ul');
      childList.className = 'md-reader-folder-list folder-children md-reader-hidden';
      li.append(childList);

      const node: DirNode = {
        url,
        childrenEl: childList,
        caret,
        iconEl: icon,
        rowEl: row,
        loaded: false,
        expanded: false,
      };
      nodes.push(node);

      row.addEventListener('click', () => void toggleDir(node));
    } else {
      // 文件：原地打开
      row.addEventListener('click', () => {
        if (options.onOpen) options.onOpen(url);
        else location.href = url;
      });
    }

    return li;
  }

  /** 展开 / 收起目录，首次展开时才取数据 */
  async function toggleDir(node: DirNode): Promise<void> {
    // 已确认是空目录（叶子），点整行也不该有反应
    if (node.caret.classList.contains('is-leaf')) return;

    if (node.expanded) {
      node.expanded = false;
      node.childrenEl.classList.add('md-reader-hidden');
      node.caret.classList.add('is-collapsed');
      node.iconEl.innerHTML = ICON_FOLDER;
      return;
    }

    if (!node.loaded) {
      node.caret.classList.add('is-loading');
      const res = await fetchDirectory(node.url);
      node.caret.classList.remove('is-loading');
      node.loaded = true;

      const entries = res.ok ? (res.entries ?? []) : [];

      if (!res.ok) {
        const err = document.createElement('li');
        err.className = 'folder-error';
        err.textContent = `读取失败：${res.error ?? '未知错误'}`;
        node.childrenEl.append(err);
      } else if (entries.length === 0) {
        /*
         * 空目录：不给任何提示，直接把它降级成叶子 —— 箭头隐藏、不可点。
         *
         * 用 is-leaf（visibility: hidden）而不是移除元素，是为了保住那 17px 的
         * 占位宽度，否则该行的图标会向左跳、与上下行错位。
         */
        node.caret.classList.add('is-leaf');
        node.caret.classList.add('is-collapsed');
        return;
      } else {
        for (const child of entries) {
          node.childrenEl.append(renderRow(child, node.url));
        }
      }
    }

    node.expanded = true;
    node.childrenEl.classList.remove('md-reader-hidden');
    node.caret.classList.remove('is-collapsed');
    node.iconEl.innerHTML = ICON_FOLDER_OPEN;
  }

  /** 加载根目录 */
  async function reload(): Promise<void> {
    list.replaceChildren();
    nodes.length = 0;
    barCount.textContent = '';

    const res = await fetchDirectory(rootDir);
    if (!res.ok) {
      const err = document.createElement('li');
      err.className = 'folder-error';
      err.textContent = `无法读取目录：${res.error ?? '未知错误'}`;
      list.append(err);
      return;
    }

    const entries = res.entries ?? [];
    barCount.textContent = `${entries.length} 项`;

    // 空了就留白，不做任何提示（提示本身也是噪音）
    for (const entry of entries) list.append(renderRow(entry, rootDir));
    applyCurrent();
  }

  void reload();

  return {
    element,
    reload: () => void reload(),
    setCurrent(url: string) {
      currentUrl = url;
      applyCurrent();
    },
    destroy() {
      nodes.length = 0;
      element.remove();
    },
  };
}
