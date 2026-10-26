/**
 * 「收藏」列表 —— 用户主动星标过的文档。
 *
 * 与历史共用 link-store 的逻辑，只有两点不同：
 *   1. storage 键名是 favorites（两份列表互不影响）
 *   2. 满了**拒绝新增**，而不是淘汰旧条目 ——
 *      收藏是用户主动保存的内容，静默删掉一条等于丢数据。
 */

import { createLinkStore } from './link-store';

/** 收藏最多保留多少条；满了之后星标会提示用户先移出一些 */
export const FAVORITES_MAX = 50;

export const favoritesStore = createLinkStore({
  key: 'favorites',
  max: FAVORITES_MAX,
  overflow: 'reject',
});
