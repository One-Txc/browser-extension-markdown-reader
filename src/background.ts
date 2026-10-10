/**
 * MD Reader —— Service Worker
 *
 * 两个职责：
 *   1. 记录「文件访问权限已被证明」（content script 成功注入即证明）
 *      —— 因为 chrome.extension.isAllowedFileSchemeAccess 在 content script 中不可用（M0 实测）
 *   2. 兜底读取本地文件，并做编码嗅探
 *      —— content script 受页面 CORS 约束读不了 file://，但 SW 有 host_permissions 可以
 */

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

    // 【临时·探针】测试 SW 能否 fetch 目录 URL 并拿到 Chrome 生成的索引 HTML
    if (msg.type === 'probe-fetch-dir') {
      probeFetchDir(msg.url ?? '').then(sendResponse);
      return true;
    }
  }
);

/**
 * 【临时·探针】背景脚本尝试请求目录 URL。
 *
 * 起因：第三方插件通过「让用户直接打开目录 URL、再解析 Chrome 生成的索引页面」
 * 实现文件树，说明 Chrome 确实会为目录 URL 产出 HTML。
 * 如果背景脚本也能 fetch 到同一份内容，就完全不需要用户授权目录了。
 */
async function probeFetchDir(
  url: string
): Promise<{ ok: boolean; status?: number; len?: number; text?: string; error?: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    return { ok: true, status: res.status, len: text.length, text: text.slice(0, 6000) };
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
