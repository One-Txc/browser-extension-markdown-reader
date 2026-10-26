/**
 * 「历史」列表 —— 最近打开过的文档。
 *
 * 数据层的全部逻辑在 link-store.ts；这个文件只声明「历史」这份列表的配置。
 * 列表满了**静默淘汰最旧的一条**：历史是自动记录的，用户对淘汰无感。
 */

import { createLinkStore } from './link-store';

/** 历史最多保留多少条 */
export const HISTORY_MAX = 50;

export const historyStore = createLinkStore({
  key: 'history',
  max: HISTORY_MAX,
  overflow: 'evict',
});
