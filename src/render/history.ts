/**
 * 「历史」面板 —— 最近打开过的文档。
 *
 * 列表形态由 link-pane.ts 提供，这里只负责历史自己的文案。
 * 历史固定按存储顺序（最新打开在前）显示，**没有排序行** ——
 * 用户不会想按文件名整理一份自动记录。
 */

import { t } from '../shared/i18n';
import { mountLinkPane, type LinkPaneHandle, type LinkPaneOptions } from './link-pane';

export type HistoryPaneOptions = Omit<LinkPaneOptions, 'labels' | 'sort'>;

export function mountHistoryPane(options: HistoryPaneOptions): LinkPaneHandle {
  return mountLinkPane({
    ...options,
    labels: {
      count: (n) => t('history_count', [String(n)]),
      empty: t('history_empty'),
      emptyHint: t('history_emptyHint'),
      clear: t('history_clear'),
      clearConfirm: t('history_clearConfirm'),
      clearHint: t('history_clearHint'),
      remove: t('history_remove'),
      openInNewTab: t('history_openInNewTab'),
      openFailed: t('history_openFailed'),
    },
  });
}
