/**
 * Markdown 数学公式支持（KaTeX）。
 *
 * ★ 关键设计：公式的 HTML 不经过 DOMPurify。
 *
 * 为什么：KaTeX 的排版完全依赖内联 style（vertical-align、height 等），
 * 而 DOMPurify 默认会把 style 属性整体剥掉，公式会彻底错位。
 * 直接放开 style 又等于允许任意 CSS 注入（例如 position:fixed 覆盖整页做点击劫持）。
 *
 * 所以这里分两步：
 *   1. markdown-it 渲染阶段：把公式替换成一个唯一占位符，KaTeX 的真实输出先存进数组
 *   2. DOMPurify 消毒完成后：再把占位符回填成 KaTeX 的输出
 *
 * 回填的内容由 KaTeX 自己生成，且 trust 保持关闭（\href 等命令不会产出真实链接），
 * 不构成新的 XSS 面。
 */

import katex from 'katex';

/** 本轮的公式输出暂存 */
let store: string[] = [];
/** 占位符随机前缀，避免与正文内容撞车 */
let nonce = '';

interface TokenLike {
  content: string;
  markup: string;
  map?: [number, number];
  type: string;
}

interface StateInlineLike {
  src: string;
  pos: number;
  posMax: number;
  push(type: string, tag: string, nesting: number): TokenLike;
}

interface StateBlockLike {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  line: number;
  push(type: string, tag: string, nesting: number): TokenLike;
}

export function resetMathStore(): void {
  store = [];
  nonce = `MDMATH${Math.random().toString(36).slice(2, 10)}M`;
}

function placeholderFor(index: number): string {
  return `${nonce}${index}END`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 渲染 LaTeX 并存档，返回占位符 */
function storeMath(tex: string, displayMode: boolean): string {
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
    });
  } catch {
    // 极端情况下 KaTeX 自己抛错，降级为原始文本
    html = `<code class="md-math-error">${escapeHtml(tex)}</code>`;
  }
  store.push(html);
  return placeholderFor(store.length - 1);
}

/** DOMPurify 之后调用，把占位符换回公式 HTML */
export function restoreMath(html: string): string {
  if (!nonce || store.length === 0) return html;

  const pattern = new RegExp(`${nonce}(\\d+)END`, 'g');
  return html.replace(pattern, (whole, index: string) => store[Number(index)] ?? whole);
}

/* --------------------------------------------------------------- 行内 $…$ */

function mathInline(state: StateInlineLike, silent: boolean): boolean {
  const start = state.pos;
  if (state.src[start] !== '$') return false;
  // $$ 交给块级规则
  if (state.src[start + 1] === '$') return false;

  const first = state.src[start + 1];
  if (first === undefined || /\s/.test(first)) return false;

  let pos = start + 1;
  let close = -1;

  while (pos < state.posMax) {
    const ch = state.src[pos];
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    // 行内公式不跨行
    if (ch === '\n') return false;
    if (ch === '$') {
      close = pos;
      break;
    }
    pos += 1;
  }

  if (close < 0) return false;

  const content = state.src.slice(start + 1, close);
  // 闭合 $ 前不能是空白，且内容不能为空
  if (!content.trim() || /\s$/.test(content)) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
    token.markup = '$';
  }
  state.pos = close + 1;
  return true;
}

/* -------------------------------------------------------------- 块级 $$…$$ */

function mathBlock(state: StateBlockLike, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];

  if (state.src.slice(start, start + 2) !== '$$') return false;

  const firstLine = state.src.slice(start + 2, max);

  // 单行形式：$$ ... $$
  const inlineClose = firstLine.indexOf('$$');
  if (inlineClose >= 0) {
    if (silent) return true;
    const token = state.push('math_block', 'math', 0);
    token.content = firstLine.slice(0, inlineClose);
    token.markup = '$$';
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }

  // 多行形式
  let body = firstLine;
  let nextLine = startLine + 1;
  let closed = false;

  for (; nextLine < endLine; nextLine += 1) {
    const lineStart = state.bMarks[nextLine];
    const lineEnd = state.eMarks[nextLine];
    const line = state.src.slice(lineStart, lineEnd);
    const index = line.indexOf('$$');
    if (index >= 0) {
      body += `\n${line.slice(0, index)}`;
      closed = true;
      break;
    }
    body += `\n${line}`;
  }

  if (!closed) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.content = body.trim();
  token.markup = '$$';
  token.map = [startLine, nextLine + 1];
  state.line = nextLine + 1;
  return true;
}

/* ---------------------------------------------------------------- 插件 */

interface MarkdownItLike {
  inline: { ruler: { before(beforeName: string, ruleName: string, fn: unknown): void } };
  block: {
    ruler: {
      before(beforeName: string, ruleName: string, fn: unknown, options?: unknown): void;
    };
  };
  renderer: { rules: Record<string, unknown> };
}

export function mathPlugin(md: MarkdownItLike): void {
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  md.renderer.rules.math_inline = (tokens: TokenLike[], idx: number): string =>
    storeMath(tokens[idx].content, false);

  md.renderer.rules.math_block = (tokens: TokenLike[], idx: number): string =>
    `<div class="md-math-block">${storeMath(tokens[idx].content, true)}</div>\n`;
}
