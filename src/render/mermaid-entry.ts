/**
 * Mermaid 图表渲染器 —— 独立 bundle，按需注入。
 *
 * ★ 为什么不打进 content.js：
 * Mermaid 体积是 Markdown 解析链的数倍，而绝大多数文档没有图表。
 * 打进主 bundle 意味着每打开一个 .md 都要下载并解析这一大坨代码。
 * 所以拆成独立文件，只在页面真的出现 ```mermaid 代码块时，
 * 由 Service Worker 通过 chrome.scripting.executeScript 注入。
 *
 * 注入目标是 ISOLATED world（与 content script 同一个 world），
 * 因此这里可以直接操作 DOM，不需要 postMessage 与页面通信。
 *
 * 幂等：靠 data-processed 属性，重复注入不会重复渲染。
 */

import mermaid from 'mermaid';

const SELECTOR = '.md-reader-mermaid:not([data-processed])';
const MAX_DIAGRAMS = 30;

function currentAppearance(): 'light' | 'dark' {
  return document.documentElement.dataset.mdReaderAppearance === 'dark' ? 'dark' : 'light';
}

mermaid.initialize({
  startOnLoad: false,
  // strict 会禁止图表里的点击事件与 HTML 标签，避免本地文档夹带脚本
  securityLevel: 'strict',
  theme: currentAppearance() === 'dark' ? 'dark' : 'default',
  fontFamily: 'inherit',
  // 渲染失败时不要往页面里插错误图形，交给我们自己降级
  suppressErrorRendering: true,
});

async function renderAll(): Promise<void> {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).slice(
    0,
    MAX_DIAGRAMS
  );

  for (const node of nodes) {
    const code = node.textContent ?? '';
    if (!code.trim()) {
      node.setAttribute('data-processed', 'empty');
      continue;
    }

    // 先占位，避免并发注入时重复渲染同一个节点
    node.setAttribute('data-processed', 'pending');

    const id = `mdreader-mmd-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const { svg } = await mermaid.render(id, code);
      node.innerHTML = svg;
      node.setAttribute('data-processed', 'ok');
      node.classList.add('md-reader-mermaid-done');
    } catch (err) {
      // 渲染失败：保留原始代码文本，并给出提示样式
      node.setAttribute('data-processed', 'error');
      node.classList.add('md-reader-mermaid-error');
      console.warn('[Markdown Read] Mermaid 渲染失败：', err);
    }
  }
}

void renderAll();
