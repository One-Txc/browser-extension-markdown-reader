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
  }
);

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
    return { ok: false, error: '仅支持 file:// 目录' };
  }

  try {
    const res = await fetch(dirUrl, { cache: 'no-store' });
    const html = await res.text();

    // ★ 不能用 res.ok 判断：file:// 的 Response 是 ok:false / status:0，但 body 完整
    if (!html) return { ok: false, error: '目录返回为空' };

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
  if (tabId == null) return { ok: false, error: '拿不到标签页 id' };

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
  if (!url.startsWith('file://')) {
    return { ok: false, error: '仅允许读取 file:// 路径' };
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

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
