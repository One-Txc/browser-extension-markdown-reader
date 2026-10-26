/**
 * 右上角的「设置」按钮：点一下打开扩展的设置面板。
 *
 * ★ 这里有个平台限制：扩展 popup **无法从页面里直接打开** ——
 * 它只能由用户点浏览器工具栏上的扩展图标来触发。
 * 仅有的途径是 `chrome.action.openPopup()`，它带两个约束：
 *   1. Chrome 127+ 才有（Firefox 没这个 API）
 *   2. **必须由用户手势触发**
 *
 * 我们是从 content script 发消息转到 background 再调用它，手势能否跨进程
 * 传到 background 并不确定。所以失败时必须回退成页面内的提示 ——
 * 静默无反应是最糟的结果，用户会以为按钮坏了。
 */

import { t } from '../shared/i18n';
import { ensureBody } from '../shared/const';
import { EXT_NAME } from '../shared/brand';
import { showToast } from './toast';

/**
 * 齿轮。
 * 齿必须是粗短的方齿，不能用细线画成放射状 —— 那样看着像发光的灯泡
 * （folder.ts 里同一个坑踩过）。
 */
const ICON_SETTINGS = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linejoin="round"><path d="M12.6 8h2M8 3.4v-2M3.4 8h-2M8 12.6v2M11.25 4.75l1.42-1.42M4.75 4.75 3.33 3.33M4.75 11.25l-1.42 1.42M11.25 11.25l1.42 1.42" stroke-width="2.3" stroke-linecap="butt"/><circle cx="8" cy="8" r="4.6" stroke-width="1.4"/><circle cx="8" cy="8" r="1.8" stroke-width="1.4"/></svg>`;

/**
 * 挂载设置按钮。
 *
 * ★ 必须先等 <body>：本函数在 main 的早期被调用，那时 content script 刚在
 * document_start 跑起来，documentElement 可能已有、body 还没有 ——
 * 直接 append 会抛 "Cannot read properties of null"。
 */
export async function mountSettingsButton(): Promise<void> {
  const body = await ensureBody();

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'md-reader-btn md-reader-btn-settings';
  button.innerHTML = ICON_SETTINGS;
  button.title = t('openSettings');
  button.setAttribute('aria-label', t('openSettings'));

  button.addEventListener('click', () => void openSettings(button));

  body.append(button);
}

/** 请求 background 打开 popup；打不开就给出可操作的提示 */
async function openSettings(anchor: HTMLElement): Promise<void> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'open-settings' })) as
      | { ok: boolean }
      | undefined;
    if (res?.ok) return;
  } catch {
    /* 落到下面的提示 */
  }
  // 打不开不是错误路径（Firefox 没有该 API，手势也可能传不过去），
  // 所以给一条可操作的建议，而不是静默无反应
  showToast(t('openSettingsHint', [EXT_NAME]), anchor);
}
