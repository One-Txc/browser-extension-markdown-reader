/**
 * 正文右上角的星标：收藏 / 取消收藏当前文档。
 *
 * ★ 只在文档真正渲染成功后才挂载（由 content.ts 在 renderDocument 里创建）——
 *   content script 会在所有网页上运行，未渲染的页面不该出现这个按钮。
 *
 * ★ 状态靠**形状**表达（空心 / 实心），颜色复用 `.is-active` 的主题强调色，
 *   这样 8 套配色下都不用单独调星标颜色。
 *
 * ★ 点击是异步的（要写 storage），加了个 busy 锁：连点两下不会写入两次。
 */

import { FAVORITES_MAX } from '../shared/favorites';
import { t } from '../shared/i18n';
import { showToast } from './toast';

/** 空星：未收藏 */
const ICON_STAR = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 1.9 9.86 5.8l4.14.6-3 3 .71 4.2L8 11.6l-3.71 2 .71-4.2-3-3 4.14-.6z"/></svg>`;

/** 实星：已收藏。形状本身表达状态，颜色仍走主题强调色 */
const ICON_STAR_FILLED = `<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 1.9 9.86 5.8l4.14.6-3 3 .71 4.2L8 11.6l-3.71 2 .71-4.2-3-3 4.14-.6z"/></svg>`;

export interface FavoriteToggleResult {
  /** 切换后的状态：true = 现在已收藏 */
  active: boolean;
  /** 收藏已满、这次没收藏上（星标保持空心，并给出提示） */
  full?: boolean;
}

export interface FavoriteButtonOptions {
  /** 当前文档是否已收藏；按钮据此决定初始状态 */
  isFavorited(): boolean;
  /** 点击切换；由调用方写 storage 并返回结果 */
  onToggle(): Promise<FavoriteToggleResult> | FavoriteToggleResult;
}

export interface FavoriteButtonHandle {
  element: HTMLButtonElement;
  /** 外部（跨标签页同步、面板移除）同步状态 */
  setActive(active: boolean): void;
  destroy(): void;
}

export function mountFavoriteButton(options: FavoriteButtonOptions): FavoriteButtonHandle {
  let active = options.isFavorited();
  let busy = false;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'md-reader-btn md-reader-btn-favorite';

  const sync = (): void => {
    button.innerHTML = active ? ICON_STAR_FILLED : ICON_STAR;
    const label = active ? t('favoriteRemove') : t('favoriteAdd');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('is-active', active);
  };

  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await options.onToggle();
      active = result.active;
      sync();
      if (result.full) {
        showToast(t('favoriteFull', [String(FAVORITES_MAX)]), button);
      }
    } finally {
      busy = false;
    }
  });

  sync();
  document.body.append(button);

  return {
    element: button,
    setActive(value: boolean) {
      active = value;
      sync();
    },
    destroy() {
      button.remove();
    },
  };
}
