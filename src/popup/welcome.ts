/**
 * 安装后打开的引导页。
 *
 * ★ 为什么值得单独开一个标签页：没权限时 content script **根本不会注入**，页面里
 *   没法提示；而 popup 要用户自己想起来去点图标。安装完成这一刻，是唯一能主动
 *   触达用户的时机。
 *
 * ★ 标签页比 popup 多一个能力：它能一直开着。用户去 chrome://extensions 打开
 *   开关再切回来，这里轮询到状态变化就直接变成「已授权」，不用手动刷新 ——
 *   popup 做不到，焦点一离开它就关了。
 */

import { EXT_NAME } from '../shared/brand';
import { setLocale } from '../shared/i18n';
import { isFileAccessAllowed, openExtensionSettings } from '../shared/permission';
import { loadSettings } from '../shared/settings';
import { renderPermissionGranted, renderPermissionGuide } from './permission-guide';

const guideEl = document.getElementById('guide') as HTMLElement;

/** 上一次渲染的状态，用来判断是否需要重绘（否则每秒重绘会让「已复制」闪掉） */
let lastAllowed: boolean | undefined;

function applyBrand(): void {
  document.querySelectorAll<HTMLElement>('[data-ext-name]').forEach((el) => {
    el.textContent = EXT_NAME;
  });
}

/**
 * 重新检测并渲染。
 * @param force 忽略状态缓存强制重绘（点「重新检测」时用）
 */
async function refresh(force = false): Promise<void> {
  const allowed = await isFileAccessAllowed();
  if (!force && allowed === lastAllowed) return;
  lastAllowed = allowed;

  if (allowed) {
    renderPermissionGranted(guideEl);
    return;
  }

  renderPermissionGuide(guideEl, {
    // 构建时 src/assets 会被整目录复制到产物目录，所以这里用相对路径即可
    screenshot: 'assets/images/authorization.png',
    // 能直接跳到扩展详情页最好；被浏览器拦下时它会自动复制地址
    onOpenSettings: openExtensionSettings,
    onRecheck: async () => {
      const allowed = await isFileAccessAllowed();
      if (allowed) {
        lastAllowed = true;
        // 直接换成「已授权」，不必等下一轮轮询
        renderPermissionGranted(guideEl);
      }
      return allowed;
    },
  });
}

async function init(): Promise<void> {
  // 语言跟着设置走：用户可能在别的设备上把界面语言定成了非浏览器语言
  const settings = await loadSettings();
  setLocale(settings.locale);

  applyBrand();
  await refresh();

  // 页面在前台时每秒看一次：用户去 chrome://extensions 开了开关、切回来这里自动变
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void refresh();
  }, 1000);
}

void init();
