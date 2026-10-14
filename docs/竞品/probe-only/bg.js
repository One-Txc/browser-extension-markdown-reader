/**
 * 极简 background：只实现 bg-fetch，复现第三方扩展的做法。
 *
 * 这里故意与第三方保持一致 —— 注意 fetch 前那个同源判断，
 * 它用的是 new URL(...).origin（file:// 会得到 "null"），而不是 location.origin。
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'bg-fetch') return;

  (async () => {
    const started = Date.now();
    try {
      const tab = sender.tab;
      console.log('[MDR探针·BG] 收到 bg-fetch');
      console.log('  请求 URL    :', msg.url);
      console.log('  发起方 tab   :', tab?.url);
      console.log('  new URL(请求).origin      :', new URL(msg.url).origin);
      if (tab?.url) console.log('  new URL(发起方).origin    :', new URL(tab.url).origin);

      const res = await fetch(msg.url);
      const text = await res.text();
      console.log('[MDR探针·BG] fetch 成功', {
        status: res.status,
        statusText: res.statusText,
        长度: text.length,
        耗时ms: Date.now() - started,
      });
      sendResponse({ ok: res.ok, status: res.status, res: text });
    } catch (err) {
      console.error('[MDR探针·BG] fetch 失败:', err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // 异步响应
});
