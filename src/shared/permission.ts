/**
 * 「允许访问文件网址」的检测。
 *
 * ★ 这个开关只能由用户在 chrome://extensions 里手动打开，扩展没有任何 API 能改它：
 *   清单里的 `file:///*` 只是「申请」，真正生效靠那个开关。
 *   所以能做的只有「查出来 + 引导用户去开」。
 *
 * ★ 为什么不用 storage 里的 fileAccessProven 当唯一判据：那个标志只有 content
 *   script 在 file:// 页面成功注入过才为真 —— 新装用户在打开第一个 md 之前永远是
 *   false，分不清「没授权」和「还没试过」。
 *   chrome.extension.isAllowedFileSchemeAccess() 能直接回答，但它只存在于扩展页面
 *   （content script 里不存在，M0 实测结论），所以下面按「能查就查」处理。
 *
 * ★ 因此这里给的是「探测」语义，返回值有三种含义：
 *   - true  / false：查到了，权限开没开
 *   - undefined：这个环境没有该 API（例如 Firefox）——怎么理解由调用方决定：
 *     popup / 引导页把 undefined 当作已授权（Firefox 本来就不需要这个开关，
 *     不能把用户卡在 Chrome 的引导页上）；后台则按「可能需要引导」处理。
 */

/** chrome.extension.isAllowedFileSchemeAccess 在两种 SDK 形态下的调用方式 */
type ProbeApi = (callback?: (allowed: boolean) => void) => Promise<boolean> | void;

/**
 * 探测超时。
 *
 * ★ 必须有：这个 API 已经弃用，个别版本上失败时只往控制台打 lastError、
 *   **回调永远不回来** —— 那样 popup 的「重新检测」会一直等着，看起来就是卡死。
 *   超时后按「查不到」处理（调用方会放过用户），比无限等待安全。
 */
const PROBE_TIMEOUT_MS = 2000;

/** 查一次「允许访问文件网址」是否已开启；没有该 API 的环境返回 undefined */
export async function probeFileAccess(): Promise<boolean | undefined> {
  const extension = chrome.extension as { isAllowedFileSchemeAccess?: ProbeApi } | undefined;
  const api = extension?.isAllowedFileSchemeAccess;
  if (typeof api !== 'function') return undefined;

  // 新版是 Promise 形式；老版本只吃回调，调用时会直接抛错，落到下面重试
  try {
    const maybe = api();
    if (maybe && typeof maybe.then === 'function') {
      const value = await Promise.race([
        maybe,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), PROBE_TIMEOUT_MS)),
      ]);
      return value === undefined ? undefined : Boolean(value);
    }
  } catch {
    /* 换回调形式 */
  }

  return await new Promise<boolean | undefined>((resolve) => {
    let settled = false;
    const finish = (value: boolean | undefined): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(undefined), PROBE_TIMEOUT_MS);

    try {
      api((allowed) => finish(Boolean(allowed)));
    } catch {
      // 两种形式都调不通：交给调用方按「查不到」处理，不要误判成「没授权」
      finish(undefined);
    }
  });
}

/**
 * 给 popup / 引导页用的判据：查不到就当作已授权。
 * 理由见文件头 —— 只有 Chrome 有这个开关，其他浏览器不该被它挡住。
 */
export async function isFileAccessAllowed(): Promise<boolean> {
  return (await probeFileAccess()) ?? true;
}

/**
 * 扩展详情页地址。
 *
 * ★ 只能让用户复制这段地址自己去开：扩展不允许直接导航到 chrome:// 协议
 *   （项目里已实测），所以别指望 chrome.tabs.create 能打开它。
 */
export function extensionSettingsUrl(): string {
  return `chrome://extensions/?id=${chrome.runtime.id}`;
}

/**
 * 尝试直接打开扩展详情页。
 *
 * ★ 各版本对「用 chrome.tabs.create 打开 chrome:// 地址」的放行程度不一样，
 *   所以这里只当它是「尽力而为」：成功返回 true；被拦下就把地址复制到剪贴板、
 *   返回 false，由界面提示用户自己粘贴 —— 无论放不放行，用户都有路可走。
 */
export async function openExtensionSettings(): Promise<boolean> {
  try {
    await chrome.tabs.create({ url: extensionSettingsUrl() });
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(extensionSettingsUrl());
    } catch {
      /* 剪贴板也不可用：地址本来就显示在页面上，可以手动选中复制 */
    }
    return false;
  }
}
