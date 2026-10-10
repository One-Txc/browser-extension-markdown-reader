/**
 * 「文件夹」面板 —— 展示当前文档所在目录的内容。
 *
 * 数据来自 background 的 list-directory（原理见 shared/directory.ts）。
 *
 * 设计要点：
 *   - 只显示目录与 Markdown 文件，其余类型过滤掉
 *   - 默认全部收起；文件夹图标随展开状态在「合上 / 打开」之间切换
 *   - **子目录按需加载** —— 展开时才请求，避免一上来就递归整棵树
 *   - 当前文档所在的那一项高亮（选中态）
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

/** 展开 / 收起箭头，与目录 tab 用的是同一套 */
const ICON_CARET = `<svg viewBox="0 0 10 10"><path d="M2 3.4 L5 6.6 L8 3.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ------------------------------------------------------------------ 类型 */

export interface FolderPaneOptions {
  /** 当前文档的绝对 URL */
  documentUrl: string;
  /** 点击 md 文件时的回调；不传则直接导航过去 */
  onOpen?: (url: string) => void;
}

export interface FolderPaneHandle {
  element: HTMLElement;
  /** 重新加载根目录（用于手动刷新） */
  reload(): void;
  destroy(): void;
}

/** 一个已渲染的目录节点 */
interface DirNode {
  url: string;
  childrenEl: HTMLElement;
  caret: HTMLButtonElement;
  iconEl: HTMLElement;
  /** null = 尚未加载 */
  loaded: boolean;
  expanded: boolean;
}

/* ------------------------------------------------------------ 数据获取 */

async function fetchDirectory(
  dirUrl: string
): Promise<{ ok: boolean; entries?: DirEntry[]; error?: string }> {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'list-directory', url: dirUrl });
    return (res as { ok: boolean; entries?: DirEntry[]; error?: string }) ?? { ok: false, error: '无响应' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ------------------------------------------------------------ 面板实现 */

export function mountFolderPane(options: FolderPaneOptions): FolderPaneHandle {
  const rootDir = directoryOf(options.documentUrl);
  const currentName = decodeURIComponent(options.documentUrl.split('/').pop() ?? '');

  const nodes: DirNode[] = [];

  const bar = document.createElement('div');
  bar.className = 'md-reader-folder-bar';

  const barName = document.createElement('span');
  barName.className = 'name';
  // 根目录名：URL 去掉结尾斜杠后取最后一段
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

  /** 渲染一行 */
  function renderRow(entry: DirEntry, parentUrl: string): HTMLElement {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'folder-row';
    if (entry.isDir) row.classList.add('is-dir');

    // 1. 折叠箭头（仅目录有，文件用等宽占位保证图标列对齐）
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

    li.append(row);

    /* ---- 目录：准备子容器与懒加载 ---- */
    if (entry.isDir && caret) {
      const childList = document.createElement('ul');
      childList.className = 'md-reader-folder-list folder-children md-reader-hidden';
      li.append(childList);

      const url = resolveEntryUrl(parentUrl, entry);
      const node: DirNode = {
        url,
        childrenEl: childList,
        caret,
        iconEl: icon,
        loaded: false,
        expanded: false,
      };
      nodes.push(node);

      caret.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void toggleDir(node);
      });
      // 点击整行也能展开，比只能点小箭头顺手
      row.addEventListener('click', () => void toggleDir(node));
    } else {
      // 文件：点击打开
      row.addEventListener('click', () => {
        const url = resolveEntryUrl(parentUrl, entry);
        if (options.onOpen) options.onOpen(url);
        else location.href = url;
      });
    }

    return li;
  }

  /** 展开 / 收起一个目录，首次展开时才去取数据 */
  async function toggleDir(node: DirNode): Promise<void> {
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

      if (!res.ok) {
        const err = document.createElement('li');
        err.className = 'folder-error';
        err.textContent = `读取失败：${res.error ?? '未知错误'}`;
        node.childrenEl.append(err);
      } else if (!res.entries?.length) {
        const empty = document.createElement('li');
        empty.className = 'folder-empty';
        empty.textContent = '没有 Markdown 文件';
        node.childrenEl.append(empty);
      } else {
        for (const child of res.entries) {
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

    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'folder-empty';
      empty.textContent = '这个目录里没有 Markdown 文件';
      list.append(empty);
      return;
    }

    for (const entry of entries) {
      const li = renderRow(entry, rootDir);
      // 当前文档高亮
      if (!entry.isDir && entry.name === currentName) {
        li.querySelector('.folder-row')?.classList.add('is-current');
      }
      list.append(li);
    }

    // 如果有高亮项，把它滚进视野
    const current = list.querySelector('.is-current');
    if (current) {
      requestAnimationFrame(() => current.scrollIntoView({ block: 'center' }));
    }
  }

  void reload();

  return {
    element,
    reload: () => void reload(),
    destroy() {
      nodes.length = 0;
      element.remove();
    },
  };
}
