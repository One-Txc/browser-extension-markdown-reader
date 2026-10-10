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
 * 浏览器明确标为 Markdown 的 MIME。
 *
 * 服务器正确配置时会给出这些值（GitHub、GitLab 的 raw 链接就是 text/plain，
 * 而自建站点常配 text/markdown）。可以放心地「只看 MIME 就接管」。
 */
const MARKDOWN_MIME = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/md',
  'text/mkd',
  'text/mdx',
]);

/**
 * 判断当前页面是否应该由本扩展接管。
 *
 * 支持本地（file://）与在线（http/https）两类文档，判断依据分两级：
 *
 *   1. MIME 明确是 Markdown（text/markdown 等）→ 直接接管。
 *      在线文档若服务器没配好，拿不到这个值，所以还需要第二条。
 *   2. MIME 是 text/plain → **必须再看路径后缀**。
 *      text/plain 太宽泛了：任何 .txt、任何无后缀的纯文本接口都是它，
 *      只凭它就接管会在无关页面上瞎渲染。第三方插件在白名单里直接放了
 *      text/plain，没有这层后缀校验，那是它的疏漏。
 *
 * 内容本身能不能读到由 readSource 兜底（读不到就不渲染），
 * 所以这里不必再检查 body > pre。
 */
export function isMarkdownPage(): boolean {
  const protocol = location.protocol;
  const isLocal = protocol === 'file:';
  const isRemote = protocol === 'http:' || protocol === 'https:';
  if (!isLocal && !isRemote) return false;

  const ct = document.contentType;
  if (MARKDOWN_MIME.has(ct)) return true;
  if (ct !== 'text/plain') return false;

  // 到这一步只可能是 text/plain，用路径后缀作为决定性依据
  return MD_RE.test(location.pathname);
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

/**
 * 等待 <body> 可用。
 *
 * 与 documentElement 不同：document_start 阶段 documentElement 可能已经存在，
 * 而 body 还没有。任何往 body 上挂元素的操作（浮动按钮、提示气泡）都必须先等它，
 * 否则会抛 "Cannot read properties of null (reading 'append')"。
 */
export async function ensureBody(timeout = 3000): Promise<HTMLElement> {
  const deadline = Date.now() + timeout;
  while (!document.body) {
    if (Date.now() > deadline) throw new Error('body 超时未就绪');
    await sleep(10);
  }
  return document.body;
}
