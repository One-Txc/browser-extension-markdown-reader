/**
 * Markdown 渲染管线：markdown-it → DOMPurify。
 *
 * 设计权衡：
 *   - html: true  —— 本地 md 里的内联 HTML（如 <br>、<details>）太常见，必须支持；
 *                    代价是必须用 DOMPurify 消毒，两者缺一不可。
 *   - 只注册常用语言到 highlight.js —— 完整包约 1MB，content script 体积敏感。
 */

import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import anchor from 'markdown-it-anchor';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import { mathPlugin, resetMathStore, restoreMath } from './math';

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

const LANGS: Record<string, unknown> = {
  bash, shell, json, javascript, typescript, python, sql, yaml,
  markdown, diff, ini, xml, css, go, java, dockerfile,
};

for (const [name, def] of Object.entries(LANGS)) {
  hljs.registerLanguage(name, def as never);
}
// 常见别名
hljs.registerAliases(['js', 'mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['html', 'xhtml', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['toml'], { languageName: 'ini' });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightCode(code: string, lang: string): string {
  const name = (lang || '').trim().toLowerCase();

  if (name && hljs.getLanguage(name)) {
    try {
      const out = hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
      // 结构对齐 highlight.js 官方推荐：hljs 类只放在 <code> 上。
      // 若给 <pre> 也加 hljs，主题的 background 会同时作用在两层，
      // 并盖掉 markdown-body 给 pre 的背景，代码块就没有容器底色了。
      return `<pre><code class="hljs language-${escapeHtml(name)}">${out}</code></pre>`;
    } catch {
      /* 落到纯文本分支 */
    }
  }
  return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight: highlightCode,
})
  .use(anchor, {
    /**
     * 保留中文等 Unicode 字母。
     *
     * 这里绝不能做 encodeURIComponent —— 那会把 id 变成 %E6%A0%87%E9%A2%98%E4%B8%80，
     * 导致 Markdown 里手写的 [跳转](#标题一) 锚点全部失效（实测踩过）。
     * 规则对齐 GitHub：小写、空白转连字符、去掉标点，保留字母与数字。
     */
    slugify: (s: string) =>
      String(s)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}\-_]/gu, '') || 'section',
    permalink: anchor.permalink.linkInsideHeader({
      symbol: '#',
      placement: 'before',
      ariaHidden: true,
    }),
  })
  // 复选框设为只读：本扩展不写回文件，可点击的框会让用户误以为改动已保存
  .use(taskLists, { enabled: false, label: true })
  .use(footnote)
  .use(mathPlugin);

/** 外链新窗口打开；内链（md 互链）保持原样交给浏览器导航 */
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = String(tokens[idx].attrGet('href') ?? '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('file:')) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/**
 * ```mermaid 代码块不交给 highlight.js，而是输出成一个占位容器，
 * 由按需注入的 Mermaid bundle 稍后填充 SVG（见 mermaid-entry.ts）。
 */
const defaultFence =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const info = tokens[idx].info ? tokens[idx].info.trim().split(/\s+/)[0].toLowerCase() : '';
  if (info === 'mermaid') {
    return `<div class="md-reader-mermaid">${escapeHtml(tokens[idx].content)}</div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

export function renderMarkdown(raw: string, baseUrl: string): string {
  resetMathStore();

  const html = md.render(raw, { baseUrl });

  const clean = DOMPurify.sanitize(html, {
    // 注意：绝不能禁掉 input —— markdown-it-task-lists 靠它渲染复选框
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'srcdoc', 'formaction'],
    ADD_ATTR: ['target', 'rel', 'checked', 'disabled', 'type', 'align'],
    ALLOW_DATA_ATTR: false,
  });

  // 公式 HTML 在这里才回填：KaTeX 依赖内联 style，而 DOMPurify 会把它剥掉。
  // 详见 math.ts 顶部的说明。
  return restoreMath(clean);
}

/** 实际用到的语言列表，供 UI 提示 */
export const SUPPORTED_LANGS = Object.keys(LANGS);
