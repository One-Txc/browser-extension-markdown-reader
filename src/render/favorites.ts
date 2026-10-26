/**
 * 「收藏」面板 —— 用户主动星标过的文档。
 *
 * 列表形态由 link-pane.ts 提供，这里只负责收藏自己的文案与排序行。
 * 排序是**显示层**行为：存储顺序永远是收藏时间倒序，用户选的是怎么看。
 */

import { t } from '../shared/i18n';
import {
  mountLinkPane,
  type LinkPaneHandle,
  type LinkPaneOptions,
  type LinkPaneSortOptions,
} from './link-pane';

export type FavoritesPaneOptions = Omit<LinkPaneOptions, 'labels' | 'sort'> & {
  /** 排序偏好的读写（不含文案，文案由本模块补） */
  sort: Omit<LinkPaneSortOptions, 'labels'>;
};

export function mountFavoritesPane(options: FavoritesPaneOptions): LinkPaneHandle {
  return mountLinkPane({
    ...options,
    labels: {
      count: (n) => t('favorites_count', [String(n)]),
      empty: t('favorites_empty'),
      emptyHint: t('favorites_emptyHint'),
      clear: t('favorites_clear'),
      clearConfirm: t('favorites_clearConfirm'),
      clearHint: t('favorites_clearHint'),
      remove: t('favorites_remove'),
      openInNewTab: t('favorites_openInNewTab'),
      openFailed: t('favorites_openFailed'),
    },
    sort: {
      ...options.sort,
      labels: {
        label: t('favorites_sort'),
        name: t('favorites_sortName'),
        time: t('favorites_sortTime'),
        asc: t('favorites_sortAsc'),
        desc: t('favorites_sortDesc'),
        ascHint: t('favorites_sortAscHint'),
        descHint: t('favorites_sortDescHint'),
      },
    },
  });
}
