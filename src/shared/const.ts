/**
 * 全局常量与页面判定。
 *
 * 判定条件来自 M0 实测报告：
 *   - file:///.../VoC%20Data%20Model.md 的 document.contentType === 'text/markdown'
 *   - DOM 结构为 <body><pre>原文</pre></body>（body 唯一子元素）
 */

/**
 * 默认接管的扩展名（小写，不含点号）。
 *
 * 收录的都是 Markdown 生态里实际在用的写法。`.mdx` 严格说是 React 组件，
 * 但它本质仍是 Markdown，当文本读没问题，所以一并放进来。
 */
export const DEFAULT_MARKDOWN_EXT: readonly string[] = [
  'md',
  'markdown',
  'mdown',
  'mkdn',
  'mkd',
  'mdwn',
  'mdtxt',
  'mdtext',
  'markdn',
  'mdx',
];

/**
 * 解析用户自定义的扩展名输入。
 *
 * 宽容处理各种写法：`.txt`、`txt`、`TXT`、`txt, log`、`txt log` 都接受，
 * 统一成小写、去掉前导点、去重。输入非法（含路径分隔符等）的项直接丢弃，
 * 免得拼出奇怪的匹配规则。
 */
export function parseExtensions(input: string): string[] {
  const out = new Set<string>();

  for (const raw of input.split(/[\s,，、;；]+/)) {
    const ext = raw.trim().replace(/^\.+/, '').toLowerCase();
    // 只允许字母数字，长度合理；其余（斜杠、星号等）一律丢弃
    if (ext && /^[a-z0-9]{1,12}$/.test(ext)) out.add(ext);
  }

  return [...out];
}

/** 路径的扩展名是否落在给定列表中（大小写不敏感） */
export function hasExtension(path: string, extensions: readonly string[]): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  // 取最后一段路径，避免把目录里的点误当扩展名
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!name.includes('.')) return false;
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return extensions.includes(ext);
}

/**
 * 合并默认与自定义扩展名。
 * 自定义只是**追加**，不允许移除默认项 —— 那会让用户在不知情的情况下
 * 弄坏对 .md 的支持，而这类"取消支持"的需求本身也很罕见。
 */
export function effectiveExtensions(custom: string): string[] {
  return [...new Set([...DEFAULT_MARKDOWN_EXT, ...parseExtensions(custom)])];
}

/**
 * 同步判定：是否"可能是"本扩展该接管的页面。
 *
 * ★ 这里**不能**参考用户设置 —— 它必须同步返回（调用方要据此决定是否
 * 先隐藏页面防闪烁），而设置是异步读的。所以自定义扩展名无从得知，
 * 只能宽容一些：MIME 是 text/plain 且有扩展名就先放行，
 * 等 main() 读到设置后再用 hasExtension 做最终确认。
 *
 * 这个宽容的代价是：访问一个没被接管的纯文本文件（例如未加入自定义列表的
 * .txt）时，页面会先被隐藏、读完设置再恢复，看起来闪一下。
 * 普通网页是 text/html，不受影响。
 */
export function mayBeMarkdownPage(): boolean {
  const protocol = location.protocol;
  if (protocol !== 'file:' && protocol !== 'http:' && protocol !== 'https:') return false;

  if (isMarkdownMime()) return true;
  if (document.contentType !== 'text/plain') return false;

  // 无扩展名的纯文本接口（如 API 返回）不收，否则误接管面太广
  return /\.[^./]+$/.test(location.pathname);
}

/**
 * 浏览器是否把当前页面明确标成了 Markdown。
 *
 * MIME 正确时**不必看扩展名** —— 自建站点常把 .md 配成 text/markdown，
 * 但用户也可能用别的后缀承载 Markdown。
 */
export function isMarkdownMime(): boolean {
  return MARKDOWN_MIME.has(document.contentType);
}

/**
 * 浏览器明确标为 Markdown 的 MIME。
 *
 * 服务器正确配置时会给出这些值（GitHub、GitLab 的 raw 链接是 text/plain，
 * 而自建站点常配 text/markdown）。可以放心地「只看 MIME 就接管」。
 */
const MARKDOWN_MIME = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/md',
  'text/mkd',
  'text/mdx',
]);

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
