/**
 * MD Reader —— Service Worker
 *
 * 三个职责：
 *   1. 记录「文件访问权限已被证明」（content script 成功注入即证明）
 *      —— 因为 chrome.extension.isAllowedFileSchemeAccess 在 content script 中不可用（M0 实测）
 *   2. 兜底读取本地文件，并做编码嗅探
 *      —— content script 受页面 CORS 约束读不了 file://，但 SW 有 host_permissions 可以
 *   3. 列举目录内容（「文件夹」面板的数据来源）
 *      —— 同样是 CORS 的原因，必须由 SW 发起
 */

import { filterEntries, parseDirectoryIndex, type DirEntry } from './shared/directory';
import { setLocale, t } from './shared/i18n';
import { loadSettings } from './shared/settings';
import type { Locale } from './shared/i18n';

/*
 * Service Worker 也要知道当前语言 —— 它产生的错误文案会直接显示给用户。
 *
 * SW 会被随时回收，模块顶层重新执行时自然重读一次设置；
 * 用户改语言时靠 storage 监听同步过来。
 */
void loadSettings().then((s) => setLocale(s.locale));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.locale) return;
  setLocale((changes.locale.newValue as Locale) ?? 'auto');
});

/** 记录最近一次收到注入上报的时间，供 popup 判断权限状态 */
chrome.runtime.onMessage.addListener(
  (msg: { type?: string; url?: string }, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'file-access-proven') {
      chrome.storage.local.set({
        fileAccessProven: true,
        fileAccessLastSeen: Date.now(),
      });
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'read-file') {
      readLocalFile(msg.url ?? '').then(sendResponse);
      return true; // 保持通道用于异步响应
    }

    if (msg.type === 'render-mermaid') {
      injectMermaid(sender.tab?.id).then(sendResponse);
      return true;
    }

    if (msg.type === 'list-directory') {
      listDirectory(msg.url ?? '').then(sendResponse);
      return true;
    }

    if (msg.type === 'open-settings') {
      openSettingsPopup().then(sendResponse);
      return true;
    }
  }
);

/**
 * 打开扩展的设置弹窗（页面右上角那个齿轮按钮请求的）。
 *
 * ★ 这是唯一可行的途径：popup 无法由页面直接打开，只能靠
 * `chrome.action.openPopup()`。它有两个约束 ——
 *   1. Chrome 127+ 才有，Firefox 完全没有这个 API
 *   2. **必须由用户手势触发**，而这里的手势是从 content script 跨进程传来的，
 *      能否被认作有效手势并不确定
 * 所以失败是正常路径而非异常，把原因返回给调用方，由它给出可操作的提示。
 * 这里不做版本号判断：用特性检测，旧版浏览器会直接抛 TypeError 被 catch 住。
 */
async function openSettingsPopup(): Promise<{ ok: boolean; error?: string }> {
  try {
    await chrome.action.openPopup();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * 列举目录内容。
 *
 * ★ 原理：Chrome 会为 file:// 的目录 URL 生成一份索引 HTML，
 * 直接 fetch 它、解析其中的 addRow(...) 调用即可，不需要任何用户授权。
 * 细节与踩过的坑见 shared/directory.ts 的文件头。
 */
async function listDirectory(
  dirUrl: string
): Promise<{ ok: boolean; entries?: DirEntry[]; error?: string }> {
  if (!dirUrl.startsWith('file://')) {
    return { ok: false, error: t('dirOnly') };
  }

  try {
    const res = await fetch(dirUrl, { cache: 'no-store' });
    const html = await res.text();

    // ★ 不能用 res.ok 判断：file:// 的 Response 是 ok:false / status:0，但 body 完整
    if (!html) return { ok: false, error: t('dirEmpty') };

    const entries = filterEntries(parseDirectoryIndex(html));
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * 按需注入 Mermaid（约 5MB，见 mermaid-entry.ts 的说明）。
 *
 * ★ 用 world: 'MAIN' 而不是默认的 ISOLATED。
 * MV3 扩展的 CSP 是 `script-src 'self'`，不允许 eval / new Function，
 * 而 Mermaid 的部分图表类型会用到它们。file:// 页面自身没有 CSP，
 * 注入到页面 world 可以避开这个限制。
 * 代价是 Mermaid 的变量会出现在页面的 window 上 —— IIFE 打包不会主动挂全局，
 * 影响可控。
 */
async function injectMermaid(tabId?: number): Promise<{ ok: boolean; error?: string }> {
  if (tabId == null) return { ok: false, error: t('noTabId') };

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['build/mermaid.js'],
      world: 'MAIN',
    });
    return { ok: true };
  } catch (err) {
    console.warn('[MD Reader] Mermaid 注入失败：', err);
    return { ok: false, error: String(err) };
  }
}

async function readLocalFile(url: string): Promise<{
  ok: boolean;
  text?: string;
  encoding?: string;
  error?: string;
}> {
  /*
   * 同时支持本地与在线：http(s) 走的是同一个 fetch，
   * 只要清单里有对应的 host_permissions。
   */
  const isHttp = url.startsWith('http://') || url.startsWith('https://');
  if (!url.startsWith('file://') && !isHttp) {
    return { ok: false, error: t('fileOnly') };
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });

    /*
     * ★ 不能用 res.ok 判断成败：file:// 的响应 ok 为 false、status 为 0，
     * 但 body 是完整的（这条踩过坑，别改回去）。
     * 只有 http(s) 才值得看状态码。
     */
    if (isHttp && !res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const buf = await res.arrayBuffer();
    const { text, encoding } = decodeSmart(buf);
    return { ok: true, text, encoding };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * 编码嗅探：中文用户的 .md 有相当比例是 GBK/GB18030。
 *
 * 策略：两种解码都试，谁的替换字符（U+FFFD）少就用谁。
 * 单看「UTF-8 是否有坏字符」不够稳 —— 反过来 GBK 解 UTF-8 文本同样会产出坏字符，
 * 用数量对比可以双向判定。
 */
function decodeSmart(buf: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buf);

  // UTF-8 BOM 优先
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const utf8Bad = countReplacement(utf8);
  if (utf8Bad === 0) return { text: utf8, encoding: 'utf-8' };

  try {
    const gbk = new TextDecoder('gbk', { fatal: false }).decode(bytes);
    if (countReplacement(gbk) < utf8Bad) return { text: gbk, encoding: 'gbk' };
  } catch {
    /* 当前环境不支持 gbk 解码器 */
  }

  return { text: utf8, encoding: 'utf-8' };
}

function countReplacement(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0xfffd) n++;
  }
  return n;
}
