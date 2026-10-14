/**
 * 探针：报告当前页面的真实数据。
 *
 * ★ 目录页要在 DOMContentLoaded 时**立即快照**一次 ——
 * 如果同一个包里还装了会渲染页面的脚本（比如第三方那个），
 * 它替换 DOM 之后就读不到 Chrome 的原始数据了。
 *
 * 结果全部打到控制台，前缀 [MDR探针]。
 */
(function () {
  const log = (...args) => console.log('[MDR探针]', ...args);
  const isDirPage = location.href.endsWith('/');

  log('页面 URL   :', location.href);
  log('是否目录页 :', isDirPage);
  log('origin     :', location.origin);

  function report(tag, html) {
    const addRowAll = (html.match(/addRow\(/g) ?? []).length;
    const anchors = document.querySelectorAll('a');
    const rows = document.querySelectorAll('tr');
    log(`—— ${tag} ——`);
    log('  HTML 长度        :', html.length);
    log('  addRow( 出现次数 :', addRowAll);
    log('  <tr> 数量        :', rows.length);
    log('  <a> 数量         :', anchors.length);
    log(
      '  前 8 个链接文本  :',
      [...anchors]
        .slice(0, 8)
        .map((a) => a.textContent.trim())
        .join(' | ')
    );
    log(
      '  <a href> 取值    :',
      [...anchors]
        .slice(0, 5)
        .map((a) => a.getAttribute('href'))
        .join(' | ')
    );
  }

  if (isDirPage) {
    // 抢在其它脚本渲染之前快照
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const html = document.body?.outerHTML ?? '';
        report('DOMContentLoaded 即时快照（Chrome 原始输出）', html);
        if (!(html.includes('addRow(') && (html.match(/addRow\(/g) ?? []).length > 1)) {
          log('  → 快照里没有文件数据，数据应是稍后由浏览器注入的');
        }
      },
      { once: true }
    );

    // 稍后再看一次，用于判断数据是什么时候出现的
    setTimeout(() => {
      const html = document.body?.outerHTML ?? '';
      report('800ms 后', html);
    }, 800);
  } else {
    // 文档页：让 background 去 fetch 所在目录
    setTimeout(async () => {
      const dirUrl = location.href.replace(/[^/]*$/, '');
      log('文档页 —— 请求所在目录 :', dirUrl);
      try {
        const res = await chrome.runtime.sendMessage({ type: 'bg-fetch', url: dirUrl });
        log('  background 返回 :', {
          ok: res?.ok,
          status: res?.status,
          error: res?.error,
          长度: res?.res?.length ?? 0,
        });
        if (res?.res) {
          const n = (res.res.match(/addRow\(/g) ?? []).length;
          log('  返回内容里 addRow( 次数 :', n);
          log(n === 0 ? '  → 只有模板，没有数据' : '  → 拿到数据了！');
        }
      } catch (err) {
        log('  调用失败 :', String(err));
      }
    }, 600);
  }
})();
