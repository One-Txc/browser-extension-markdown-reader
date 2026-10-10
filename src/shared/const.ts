/**
 * 全局常量与页面判定。
 *
 * 判定条件来自 M0 实测报告：
 *   - file:///.../VoC%20Data%20Model.md 的 document.contentType === 'text/markdown'
 *   - DOM 结构为 <body><pre>原文</pre></body>（body 唯一子元素）
 */

/** Markdown 扩展名 */
export const MD_RE = /\.(md|markdown|mdown|mkd|mdx)$/i;

/** 幂等标记：避免重复注入（刷新、其它 Markdown 扩展共存时） */
export const DONE_ATTR = 'data-md-reader-done';

/** 注入样式的 <style> id */
export const STYLE_ID = 'md-reader-styles';

/** 根容器 class */
export const ROOT_CLASS = 'md-reader-root';

/**
 * 原文视图下挂在 body 上的标记 class。
 * 由 source-view.ts 写入，toc.ts 读取 —— 放在这里避免两处各写一遍字符串。
 */
export const SOURCE_MODE_CLASS = 'md-reader-source-mode';

/**
 * 判断当前页面是否应该由本扩展接管。
 *
 * contentType 实测为 text/markdown；同时兼容 text/plain
 * （Chrome 在部分平台/版本上会把 .md 当纯文本处理）。
 */
export function isMarkdownPage(): boolean {
  if (location.protocol !== 'file:') return false;
  if (!MD_RE.test(location.pathname)) return false;

  const ct = document.contentType;
  return ct === 'text/markdown' || ct === 'text/plain';
}

/**
 * 安全解码 URL 片段。
 *
 * decodeURIComponent 遇到非法转义序列（最典型的是裸的 `%`，例如文件名
 * 「100%完成.md」若没被正确编码）会抛 URIError。这类调用散布在列表渲染
 * 的循环里，一抛就整个面板渲染中断 —— 所以统一兜住：解不开就原样返回，
 * 最坏情况是显示成编码后的字面量，而不是白屏。
 */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * 从 file:// URL 取出文件名（已解码）作为标题。
 *
 * 接受 URL 参数而不是直接读 location：原地切换文档时页面地址不变，
 * 标题必须跟着「正在显示的文档」走。
 */
export function titleFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').pop() ?? '';
    return safeDecode(seg);
  } catch {
    return '';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 等待 documentElement 可用（document_start 阶段可能还不存在） */
export async function ensureDocumentElement(timeout = 3000): Promise<HTMLElement> {
  const deadline = Date.now() + timeout;
  while (!document.documentElement) {
    if (Date.now() > deadline) throw new Error('documentElement 超时未就绪');
    await sleep(10);
  }
  return document.documentElement;
}
