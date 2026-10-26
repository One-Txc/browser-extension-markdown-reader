/**
 * 通用「文档列表」面板 —— 「收藏」与「历史」共用。
 *
 * 两个面板除了文案与「有没有排序行」之外完全一致，所以这里抽成一份：
 * 两行式排版（文件名 + 时间 / 目录）、当前项高亮、点行原地换正文、
 * 行尾跳转与移除、清空两步确认、空状态、打开失败提示。
 *
 * 面板自己不碰 storage：数据由调用方通过 getItems 提供，写入走回调，
 * 这样面板与数据层可以各自单独测试。
 *
 * ★ 不 import 任何 i18n key：所有文案由调用方传进来（labels / sort.labels），
 *   这样「从历史中移除」与「移出收藏」这类差异不会在模块里长出分支。
 */

import type { LinkEntry, LinkSort } from '../shared/link-store';
import {
  formatLinkFullTime,
  formatLinkTime,
  linkDirOf,
  normalizeLinkUrl,
  sortLinks,
} from '../shared/link-store';
import { effectiveLocale } from '../shared/i18n';
import { ICON_JUMP, ICON_MD } from './icons';

/** 移除单条用的 ×（两条斜线，与其它图标同一套描边参数） */
const ICON_REMOVE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6"/></svg>`;

/**
 * 语言代码到 BCP47 标签的映射，只给 Intl 用。
 * 手动选语言时表里的是 `zh_CN` 这种下划线形式，`new Intl` 不认。
 */
const LOCALE_TAGS: Record<string, string> = {
  zh_CN: 'zh-CN',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
};

function localeTag(): string {
  const locale = effectiveLocale();
  return LOCALE_TAGS[locale] ?? locale.replace(/_/g, '-');
}

export interface LinkPaneLabels {
  count(n: number): string;
  empty: string;
  emptyHint: string;
  clear: string;
  clearConfirm: string;
  clearHint: string;
  /** 历史是「从历史中移除」，收藏是「移出收藏」 */
  remove: string;
  openInNewTab: string;
  openFailed: string;
}

/** 排序行的文案；只有提供 sort 的面板才需要 */
export interface LinkSortLabels {
  label: string;
  name: string;
  time: string;
  asc: string;
  desc: string;
  ascHint: string;
  descHint: string;
}

export interface LinkPaneSortOptions {
  labels: LinkSortLabels;
  /** 读取当前排序偏好 */
  get(): LinkSort;
  /** 写入排序偏好（调用方负责持久化；面板随后重绘） */
  set(patch: Partial<LinkSort>): void;
}

export interface LinkPaneOptions {
  labels: LinkPaneLabels;
  /** 当前列表；面板渲染时才排序 / 遍历 */
  getItems(): readonly LinkEntry[];
  /** 当前正在显示的文档 URL，用于高亮 */
  currentUrl(): string;
  /** 点击一行 → 原地打开；返回 false 表示打开失败（面板显示提示） */
  onOpen(url: string): boolean | Promise<boolean>;
  /** 点击跳转图标 → 新标签页打开；不实现时用 window.open 兜底 */
  onOpenNewTab?(url: string): void;
  /** 移除单条 */
  onRemove(url: string): void;
  /** 清空全部（面板已完成两步确认） */
  onClear(): void;
  /** 提供时在顶栏下方渲染排序行（收藏）；不提供则按存储顺序显示（历史） */
  sort?: LinkPaneSortOptions;
}

export interface LinkPaneHandle {
  element: HTMLElement;
  /** 数据或排序变化后重绘（保留滚动位置） */
  refresh(): void;
  /** 原地切换文档后更新高亮 */
  setCurrent(url: string): void;
  destroy(): void;
}

/** 创建带 class 的空元素，省掉重复的 createElement + className */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function mountLinkPane(options: LinkPaneOptions): LinkPaneHandle {
  const { labels } = options;
  /** 当前高亮项（已归一化） */
  let currentUrl = normalizeLinkUrl(options.currentUrl());
  /** 「清空」是否已进入确认态 */
  let confirmingClear = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  /* ---------------- 顶栏 ---------------- */

  const bar = el('div', 'md-reader-link-bar');

  const count = el('span', 'count');

  const clearBtn = el('button', 'link-tool link-clear');
  clearBtn.type = 'button';
  clearBtn.textContent = labels.clear;
  clearBtn.title = labels.clearHint;
  clearBtn.setAttribute('aria-label', labels.clearHint);

  bar.append(count, clearBtn);

  /* ---------------- 排序行（可选） ---------------- */

  const sort = options.sort;
  let sortSelect: HTMLSelectElement | null = null;
  let ascBtn: HTMLButtonElement | null = null;

  const sortBox = el('div', 'link-sort-box');
  if (sort) {
    const sortRow = el('div', 'link-sort-row');

    const sortLabel = el('span', 'link-sort-label');
    sortLabel.textContent = sort.labels.label;

    sortSelect = el('select', 'link-sort-select');
    // 选项顺序：时间在前（默认值），名称在后
    for (const [value, text] of [
      ['time', sort.labels.time],
      ['name', sort.labels.name],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      sortSelect.append(opt);
    }
    sortSelect.addEventListener('change', () => {
      sort.set({ field: sortSelect?.value === 'name' ? 'name' : 'time' });
      refresh();
    });

    ascBtn = el('button', 'link-tool link-asc');
    ascBtn.type = 'button';
    ascBtn.addEventListener('click', () => {
      sort.set({ ascending: !sort.get().ascending });
      refresh();
    });

    sortRow.append(sortLabel, sortSelect, ascBtn);
    sortBox.append(sortRow);
  }

  /* ---------------- 错误提示 ---------------- */

  const errorEl = el('div', 'link-error md-reader-hidden');

  /* ---------------- 列表 ---------------- */

  const list = el('ul', 'md-reader-link-list');

  const empty = el('div', 'link-empty md-reader-hidden');
  const emptyTitle = el('div', 'link-empty-title');
  emptyTitle.textContent = labels.empty;
  const emptyHint = el('div', 'link-empty-hint');
  emptyHint.textContent = labels.emptyHint;
  empty.append(emptyTitle, emptyHint);

  const scroll = el('div', 'md-reader-link-scroll');
  scroll.append(list, empty);

  const element = el('div', 'md-reader-link-pane');
  element.append(bar);
  if (sort) element.append(sortBox);
  element.append(errorEl, scroll);

  /* ---------------- 行为 ---------------- */

  function hideError(): void {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    errorEl.classList.add('md-reader-hidden');
  }

  function showError(message: string): void {
    errorEl.textContent = message;
    errorEl.classList.remove('md-reader-hidden');
    if (errorTimer) clearTimeout(errorTimer);
    // 4 秒后自动消失：这类提示不需要用户手动关闭
    errorTimer = setTimeout(hideError, 4000);
  }

  function applyCurrent(): void {
    const target = normalizeLinkUrl(currentUrl);
    for (const row of element.querySelectorAll<HTMLElement>('.link-row')) {
      row.classList.toggle('is-current', row.dataset.url === target);
    }
  }

  /** 把排序偏好回填到控件上 */
  function syncSortUi(): void {
    if (!sort || !sortSelect || !ascBtn) return;
    const current = sort.get();
    sortSelect.value = current.field;
    ascBtn.textContent = current.ascending ? sort.labels.asc : sort.labels.desc;
    ascBtn.title = current.ascending ? sort.labels.ascHint : sort.labels.descHint;
    ascBtn.setAttribute('aria-label', ascBtn.title);
  }

  /** 行尾小图标按钮 */
  function toolButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'link-tool');
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon;
    btn.addEventListener('click', (ev) => {
      // 行本身有点击行为，图标必须拦住冒泡
      ev.stopPropagation();
      onClick();
    });
    return btn;
  }

  async function open(url: string): Promise<void> {
    hideError();
    let ok = false;
    try {
      ok = await options.onOpen(url);
    } catch {
      ok = false;
    }
    if (!ok) {
      showError(labels.openFailed);
      return;
    }
    currentUrl = normalizeLinkUrl(url);
    applyCurrent();
  }

  function renderRow(entry: LinkEntry): HTMLLIElement {
    const li = el('li', 'link-item');

    const row = el('div', 'link-row');
    row.dataset.url = entry.url;
    row.title = entry.url;

    const icon = el('span', 'link-icon');
    icon.innerHTML = ICON_MD;

    const main = el('span', 'link-main');

    const name = el('span', 'link-name');
    name.textContent = entry.name;
    name.title = entry.name;

    const meta = el('span', 'link-meta');

    const dir = el('span', 'link-dir');
    dir.textContent = linkDirOf(entry.url);
    dir.title = linkDirOf(entry.url);

    const time = el('span', 'link-time');
    time.textContent = formatLinkTime(entry.time, Date.now(), localeTag());
    time.title = formatLinkFullTime(entry.time, localeTag());

    meta.append(dir, time);
    main.append(name, meta);

    const jump = toolButton(ICON_JUMP, labels.openInNewTab, () => {
      if (options.onOpenNewTab) options.onOpenNewTab(entry.url);
      else window.open(entry.url, '_blank');
    });
    jump.classList.add('link-jump');

    const remove = toolButton(ICON_REMOVE, labels.remove, () => options.onRemove(entry.url));
    remove.classList.add('link-remove');

    const actions = el('span', 'link-actions');
    actions.append(jump, remove);

    row.append(icon, main, actions);
    row.addEventListener('click', () => void open(entry.url));
    li.append(row);
    return li;
  }

  function resetClear(): void {
    confirmingClear = false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    clearBtn.textContent = labels.clear;
    clearBtn.title = labels.clearHint;
    clearBtn.classList.remove('is-confirm');
  }

  clearBtn.addEventListener('click', () => {
    if (clearBtn.disabled) return;

    if (!confirmingClear) {
      // 第一次点击只进入确认态，3 秒没再点就自动撤回
      confirmingClear = true;
      clearBtn.textContent = labels.clearConfirm;
      clearBtn.classList.add('is-confirm');
      confirmTimer = setTimeout(resetClear, 3000);
      return;
    }

    resetClear();
    options.onClear();
  });

  function refresh(): void {
    const raw = options.getItems();
    // 排序只影响显示，存储顺序保持「最新在前」
    const items = sort ? sortLinks(raw, sort.get()) : [...raw];
    // 重绘后把滚动位置放回去，避免刷新时列表跳动
    const scrollTop = scroll.scrollTop;

    list.replaceChildren();
    for (const item of items) list.append(renderRow(item));

    empty.classList.toggle('md-reader-hidden', items.length > 0);
    count.textContent = labels.count(items.length);
    clearBtn.disabled = items.length === 0;

    resetClear();
    hideError();
    syncSortUi();
    applyCurrent();
    scroll.scrollTop = scrollTop;
  }

  refresh();

  return {
    element,
    refresh,
    setCurrent(url: string) {
      currentUrl = normalizeLinkUrl(url);
      applyCurrent();
    },
    destroy() {
      if (confirmTimer) clearTimeout(confirmTimer);
      if (errorTimer) clearTimeout(errorTimer);
      element.remove();
    },
  };
}
