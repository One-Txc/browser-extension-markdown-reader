/**
 * 「文件夹」面板 —— 展示当前文档所在目录的内容。
 *
 * 数据来自 background 的 list-directory（原理见 shared/directory.ts）。
 *
 * 交互设计（与主流 Markdown 阅读器一致）：
 *   - 点文件夹   → 就地展开 / 收起，子目录按需加载
 *   - 点文档     → **原地替换正文，不改变 URL**，由 onOpen 回调实现
 *   - 行尾跳转图标 → 真正打开该 URL，由 onNavigate 回调实现
 *
 * 面板偏好（排序、文件夹置顶、显示隐藏项）通过 getPrefs / setPrefs 存取，
 * 由调用方负责持久化 —— 这些选项刷新后必须保留。
 *
 * 其他要点：
 *   - 只显示目录与 Markdown 文件
 *   - 默认全部收起；文件夹图标随展开状态切换
 *   - 空目录加载后会降级为叶子（隐藏箭头、不可点）
 *   - 图标一律用 currentColor，深浅主题自动跟随
 */

import {
  directoryOf,
  filterEntries,
  resolveEntryUrl,
  sortEntries,
  type DirEntry,
  type SortField,
} from '../shared/directory';
import { t } from '../shared/i18n';

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

/**
 * 折叠全部：两个 V 形叠着朝上，表示「一路收到顶层」。
 * 这是编辑器里「折叠全部」的通行画法（VS Code 同款）。
 */
const ICON_COLLAPSE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.4 8 3.4l4 4"/><path d="M4 12.4 8 8.4l4 4"/></svg>`;

/**
 * 齿轮。
 *
 * ★ 齿必须是**粗短的方齿**，不能用同样的细线画成放射状 ——
 * 细放射线 + 中心圆看起来是「发光的灯泡」而不是齿轮（实际返工过一次）。
 * 所以齿用加粗的 butt 端直线，与齿根圆分成两个元素各自设 stroke-width。
 */
const ICON_SETTINGS = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linejoin="round"><path d="M12.6 8h2M8 3.4v-2M3.4 8h-2M8 12.6v2M11.25 4.75l1.42-1.42M4.75 4.75 3.33 3.33M4.75 11.25l-1.42 1.42M11.25 11.25l1.42 1.42" stroke-width="2.3" stroke-linecap="butt"/><circle cx="8" cy="8" r="4.6" stroke-width="1.4"/><circle cx="8" cy="8" r="1.8" stroke-width="1.4"/></svg>`;

/* ------------------------------------------------------------------ 类型 */

/** 文件夹面板的偏好，由调用方持久化 */
export interface FolderPrefs {
  sortField: SortField;
  sortAsc: boolean;
  foldersFirst: boolean;
  showHidden: boolean;
  /** 设置面板是否展开 */
  settingsOpen: boolean;
}

export interface FolderPaneOptions {
  /** 当前文档的绝对 URL */
  documentUrl: string;
  /** 读取当前偏好 */
  getPrefs(): FolderPrefs;
  /** 更新偏好（调用方负责落盘；面板会据此重新渲染） */
  setPrefs(patch: Partial<FolderPrefs>): void;
  /** 点击文档项 → 由调用方决定如何展示（本项目为原地替换正文） */
  onOpen?: (url: string) => void;
  /** 点击行尾跳转图标 → 真正打开该 URL */
  onNavigate?: (url: string) => void;
}

export interface FolderPaneHandle {
  element: HTMLElement;
  reload(): void;
  /** 原地切换后更新选中项 */
  setCurrent(url: string): void;
  destroy(): void;
}

interface DirNode {
  url: string;
  childrenEl: HTMLElement;
  caret: HTMLButtonElement;
  iconEl: HTMLElement;
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
        error: t('folder_noResponse'),
      }
    );
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ------------------------------------------------------------ 面板实现 */

export function mountFolderPane(options: FolderPaneOptions): FolderPaneHandle {
  const rootDir = directoryOf(options.documentUrl);
  let currentUrl = options.documentUrl;
  const nodes: DirNode[] = [];

  /* ---------------- 顶栏 ---------------- */

  const bar = document.createElement('div');
  bar.className = 'md-reader-folder-bar';

  const barName = document.createElement('span');
  barName.className = 'name';
  const segs = rootDir.replace(/\/$/, '').split('/');
  barName.textContent = decodeURIComponent(segs[segs.length - 1] ?? '') || '/';

  const barCount = document.createElement('span');
  barCount.className = 'count';

  const mkTool = (icon: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'folder-tool';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return b;
  };

  const collapseBtn = mkTool(ICON_COLLAPSE, t('folder_collapseAll'), () => collapseAll());
  const settingsBtn = mkTool(ICON_SETTINGS, t('folder_settings'), () => {
    // 依据当前 DOM 状态翻转，避免与实际显示不一致；并把这个选择持久化
    const open = settingsEl.classList.contains('md-reader-hidden');
    settingsEl.classList.toggle('md-reader-hidden', !open);
    settingsBtn.classList.toggle('is-active', open);
    options.setPrefs({ settingsOpen: open });
  });

  bar.append(barName, barCount, collapseBtn, settingsBtn);

  /* ---------------- 设置面板 ---------------- */

  // 默认展开；用户收起后这个状态会被记住，刷新仍然收起
  const settingsOpenInitially = options.getPrefs().settingsOpen;

  const settingsEl = document.createElement('div');
  settingsEl.className = settingsOpenInitially
    ? 'folder-settings'
    : 'folder-settings md-reader-hidden';
  settingsBtn.classList.toggle('is-active', settingsOpenInitially);

  // 排序字段
  const sortRow = document.createElement('div');
  sortRow.className = 'folder-setting-row';
  const sortLabel = document.createElement('span');
  sortLabel.className = 'folder-setting-label';
  sortLabel.textContent = t('folder_sort');

  const sortSelect = document.createElement('select');
  sortSelect.className = 'folder-select';
  for (const [value, label] of [
    ['name', t('folder_sortName')],
    ['size', t('folder_sortSize')],
    ['modified', t('folder_sortModified')],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sortSelect.append(opt);
  }
  sortSelect.addEventListener('change', () => {
    options.setPrefs({ sortField: sortSelect.value as SortField });
    void reload();
  });

  const ascBtn = document.createElement('button');
  ascBtn.type = 'button';
  ascBtn.className = 'folder-tool folder-asc';
  ascBtn.addEventListener('click', () => {
    options.setPrefs({ sortAsc: !options.getPrefs().sortAsc });
    syncSettingsUi();
    void reload();
  });

  sortRow.append(sortLabel, sortSelect, ascBtn);

  // 复选框
  const mkCheck = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLLabelElement => {
    const wrap = document.createElement('label');
    wrap.className = 'folder-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.addEventListener('change', () => {
      set(input.checked);
      void reload();
    });
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(input, span);
    return wrap;
  };

  const foldersFirstCheck = mkCheck(
    t('folder_foldersFirst'),
    () => options.getPrefs().foldersFirst,
    (v) => options.setPrefs({ foldersFirst: v })
  );
  const showHiddenCheck = mkCheck(
    t('folder_showHidden'),
    () => options.getPrefs().showHidden,
    (v) => options.setPrefs({ showHidden: v })
  );

  settingsEl.append(sortRow, foldersFirstCheck, showHiddenCheck);

  /** 把偏好回填到设置控件（排序/方向可能被外部改动） */
  function syncSettingsUi(): void {
    const p = options.getPrefs();
    sortSelect.value = p.sortField;
    ascBtn.textContent = p.sortAsc ? t('folder_sortAsc') : t('folder_sortDesc');
    ascBtn.title = p.sortAsc ? t('folder_sortAscHint') : t('folder_sortDescHint');
    const a = foldersFirstCheck.querySelector('input');
    if (a) a.checked = p.foldersFirst;
    const b = showHiddenCheck.querySelector('input');
    if (b) b.checked = p.showHidden;
  }
  syncSettingsUi();

  /* ---------------- 列表 ---------------- */

  const list = document.createElement('ul');
  list.className = 'md-reader-folder-list';

  const scroll = document.createElement('div');
  scroll.className = 'md-reader-folder-scroll';
  scroll.append(list);

  const element = document.createElement('div');
  element.className = 'md-reader-folder';
  element.append(bar, settingsEl, scroll);

  /* ---------------- 行为 ---------------- */

  /** 高亮当前正在显示的文档 */
  function applyCurrent(): void {
    const target = decodeURIComponent(currentUrl);
    for (const row of element.querySelectorAll<HTMLElement>('.folder-row')) {
      row.classList.toggle('is-current', row.dataset.url === target);
    }
    const active = element.querySelector('.is-current');
    if (active) requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest' }));
  }

  /** 折叠全部已展开的目录 */
  function collapseAll(): void {
    for (const node of nodes) {
      if (!node.expanded) continue;
      node.expanded = false;
      node.childrenEl.classList.add('md-reader-hidden');
      node.caret.classList.add('is-collapsed');
      node.iconEl.innerHTML = ICON_FOLDER;
    }
  }

  /** 按当前偏好过滤 + 排序 */
  function ordered(entries: DirEntry[]): DirEntry[] {
    const p = options.getPrefs();
    return sortEntries(filterEntries(entries, p.showHidden), {
      field: p.sortField,
      ascending: p.sortAsc,
      foldersFirst: p.foldersFirst,
    });
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
      caret.title = t('folder_toggle');
      caret.setAttribute('aria-label', t('folder_toggle'));
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
    label.title = entry.name;
    row.append(label);

    // 4. 跳转图标
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'folder-jump';
    jump.title = entry.isDir ? t('folder_openDirInNewTab') : t('folder_openFileInNewTab');
    jump.setAttribute('aria-label', jump.title);
    jump.innerHTML = ICON_JUMP;
    jump.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (options.onNavigate) options.onNavigate(url);
      else window.open(url, '_blank');
    });
    row.append(jump);

    li.append(row);

    if (entry.isDir && caret) {
      const childList = document.createElement('ul');
      childList.className = 'md-reader-folder-list folder-children md-reader-hidden';
      li.append(childList);

      const node: DirNode = {
        url,
        childrenEl: childList,
        caret,
        iconEl: icon,
        loaded: false,
        expanded: false,
      };
      nodes.push(node);
      row.addEventListener('click', () => void toggleDir(node));
    } else {
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
        err.textContent = t('folder_readFailed', [res.error ?? t('folder_unknownError')]);
        node.childrenEl.append(err);
      } else if (entries.length === 0) {
        /*
         * 空目录：不给提示，直接降级为叶子。
         * 用 is-leaf（visibility: hidden）而不是移除元素，保住 17px 占位，
         * 否则该行图标会左移、与上下行错位。
         */
        node.caret.classList.add('is-leaf', 'is-collapsed');
        return;
      } else {
        for (const child of ordered(entries)) {
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
      err.textContent = t('folder_listFailed', [res.error ?? t('folder_unknownError')]);
      list.append(err);
      return;
    }

    const entries = ordered(res.entries ?? []);
    barCount.textContent = t('folder_count', [String(entries.length)]);

    // 空了就留白，不做任何提示
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
